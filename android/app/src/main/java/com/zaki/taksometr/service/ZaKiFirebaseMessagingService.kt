package com.zaki.taksometr.service

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.zaki.taksometr.R
import com.zaki.taksometr.ZaKiApp
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Constants
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@AndroidEntryPoint
class ZaKiFirebaseMessagingService : FirebaseMessagingService() {

    @Inject lateinit var authRepository: AuthRepository
    @Inject lateinit var deliveryRepository: DeliveryRepository
    @Inject lateinit var fusedLocationClient: FusedLocationProviderClient
    @Inject lateinit var firestore: FirebaseFirestore
    @Inject lateinit var prefs: SharedPreferences
    // Delivery chain local storage removed from FCM handler

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        CoroutineScope(Dispatchers.IO).launch {
            authRepository.updateFcmToken(token)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val type = message.data["type"]

        when (type) {
            "REQUEST_LOCATION" -> handleLocationRequest()
            "ADMIN_MARKETPLACE_ORDER" -> {
                message.data["deliveryId"]?.let { deliveryId ->
                    prefs.edit().putString(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID, deliveryId).apply()
                }
                val title = message.data["title"] ?: message.notification?.title ?: "Новый заказ"
                val body  = message.data["body"]  ?: message.notification?.body  ?: "Свободный заказ ожидает принятия"
                showNotification(title, body, ZaKiApp.NEW_ORDER_CHANNEL_ID)
            }
            "ADMIN_ORDER_UPDATED" -> {
                val deliveryId = message.data["deliveryId"]
                CoroutineScope(Dispatchers.IO).launch {
                    // Pull the edited addresses/phone/type into Room immediately.
                    // The active screen observes Room, so its map and geofence
                    // switch to the corrected order without an app restart.
                    if (!deliveryId.isNullOrEmpty()) {
                        deliveryRepository.syncDeliveryStatusFromFirestore(deliveryId)
                    }
                    deliveryRepository.syncRemoteActiveDelivery()
                    // Reload the tracking service's in-memory route/type state.
                    // In particular, a changed pickup resets the old distance
                    // anchor before GPS points for the new pickup are counted.
                    LocationTrackingService.switchService(this@ZaKiFirebaseMessagingService)
                }
                val title = message.data["title"] ?: message.notification?.title ?: "Заказ изменён"
                val body = message.data["body"] ?: message.notification?.body ?: "Диспетчер обновил данные заказа"
                showNotification(title, body)
            }
            "WINNER_ANNOUNCEMENT" -> {
                // The in-app congratulation dialog is driven by the Firestore
                // listener; here we just surface a system notification so the
                // courier is informed even when the app is in the background.
                val title = message.data["title"] ?: message.notification?.title ?: "🏆 Победитель месяца"
                val body  = message.data["body"]  ?: message.notification?.body  ?: ""
                if (body.isNotEmpty()) {
                    showNotification(title, body)
                }
            }
            "COMMISSION_TIER_REACHED" -> {
                // Progressive commission ladder: the courier reached a daily
                // delivery threshold and the commission was lowered.
                val title = message.data["title"] ?: message.notification?.title ?: "Комиссия снижена"
                val body  = message.data["body"]  ?: message.notification?.body  ?: ""
                if (body.isNotEmpty()) {
                    showNotification(title, body)
                }
            }
            "BALANCE_TRANSFER_RECEIVED" -> {
                val title = message.data["title"] ?: message.notification?.title ?: "Баланс пополнен переводом"
                val body = message.data["body"] ?: message.notification?.body ?: ""
                if (body.isNotEmpty()) {
                    showNotification(title, body)
                }
            }
            else -> {
                val title = message.data["title"] ?: message.notification?.title ?: "ZaKi"
                val body  = message.data["body"]  ?: message.notification?.body  ?: ""
                if (body.isNotEmpty()) {
                    showNotification(title, body)
                }
            }
        }
    }

    // Delivery chain push handling removed

    /**
     * Handle admin's request for current location.
     * Gets a single high-accuracy location fix and updates Firestore.
     * Works even when the app is in the background (FCM data messages wake the app).
     */
    @SuppressLint("MissingPermission")
    private fun handleLocationRequest() {
        val userId = prefs.getString(Constants.PREF_USER_ID, "") ?: ""
        if (userId.isEmpty()) return

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            1000L
        ).apply {
            setMaxUpdates(1)
            setDurationMillis(10000)
        }.build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    // Update Firestore with current location
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            firestore.collection(Constants.COLLECTION_USERS)
                                .document(userId)
                                .update(
                                    mapOf(
                                        "lastLocation" to mapOf(
                                            "latitude" to location.latitude,
                                            "longitude" to location.longitude,
                                            "timestamp" to System.currentTimeMillis()
                                        )
                                    )
                                )
                        } catch (_: Exception) {}
                    }
                }
                // Remove updates after getting the fix
                fusedLocationClient.removeLocationUpdates(this)
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                callback,
                Looper.getMainLooper()
            )
        } catch (_: Exception) {}
    }

    private fun showNotification(
        title: String,
        body: String,
        channelId: String = ZaKiApp.NOTIFICATION_CHANNEL_ID
    ) {
        val intent = Intent(this, com.zaki.taksometr.presentation.MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Show the app's own launcher icon as the large (colorful) icon so the
        // notification is instantly recognizable as ZaKi, like other apps.
        val largeIcon = android.graphics.BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notification)
            .apply { largeIcon?.let { setLargeIcon(it) } }
            // Brand green tint applied to the small (status-bar) icon.
            .setColor(android.graphics.Color.parseColor("#3786F6"))
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // Android 7 and older do not have notification channels, so set
            // the custom sound on the notification itself as well.
            .apply {
                if (channelId == ZaKiApp.NEW_ORDER_CHANNEL_ID) {
                    setSound(Uri.parse("android.resource://$packageName/${R.raw.notice8}"))
                }
            }
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(System.currentTimeMillis().toInt(), notification)
    }
}
