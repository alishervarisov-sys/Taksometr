package com.zaki.taksometr.service

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
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
import com.zaki.taksometr.util.Constants
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class ZaKiFirebaseMessagingService : FirebaseMessagingService() {

    @Inject lateinit var authRepository: AuthRepository
    @Inject lateinit var fusedLocationClient: FusedLocationProviderClient
    @Inject lateinit var firestore: FirebaseFirestore
    @Inject lateinit var prefs: SharedPreferences

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
            else -> {
                val title = message.notification?.title ?: message.data["title"] ?: "ZaKi Taksometr"
                val body = message.notification?.body ?: message.data["body"] ?: ""
                if (body.isNotEmpty()) {
                    showNotification(title, body)
                }
            }
        }
    }

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

    private fun showNotification(title: String, body: String) {
        val notification = NotificationCompat.Builder(this, ZaKiApp.NOTIFICATION_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notification)
            .setAutoCancel(true)
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(System.currentTimeMillis().toInt(), notification)
    }
}
