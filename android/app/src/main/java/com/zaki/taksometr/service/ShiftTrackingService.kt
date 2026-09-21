package com.zaki.taksometr.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.google.firebase.firestore.FirebaseFirestore
import com.zaki.taksometr.R
import com.zaki.taksometr.ZaKiApp
import com.zaki.taksometr.presentation.MainActivity
import com.zaki.taksometr.util.Constants
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import javax.inject.Inject

/**
 * Continuous, always-on-while-on-shift location tracker.
 *
 * Unlike [LocationTrackingService] (which runs only during an active delivery and
 * powers the trip meter), this service runs the whole time the courier is on
 * shift — even when no order/meter is running. It records low-frequency
 * breadcrumbs into `courier_tracks/{courierId}/points` so the dispatcher can see
 * where a courier actually drove, including "off-meter" driving (working without
 * starting the counter).
 *
 * It also keeps `users/{courierId}.lastLocation` fresh so the live map shows the
 * courier even between orders, and records `users/{courierId}.locationStatus`
 * (enabled/since) whenever the device stops delivering fixes — e.g. the courier
 * turned GPS off — so those gaps are visible and flagged in the admin panel.
 *
 * NOTE: no app can record location while the OS-level location permission is
 * revoked or device location is switched off. What we do instead is (a) track
 * continuously whenever location IS available, and (b) surface the "disabled"
 * periods to the admin.
 */
@AndroidEntryPoint
class ShiftTrackingService : Service() {

    @Inject lateinit var fusedLocationClient: FusedLocationProviderClient
    @Inject lateinit var firestore: FirebaseFirestore
    @Inject lateinit var prefs: SharedPreferences

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null
    private var locationCallback: LocationCallback? = null
    private var lastWriteAt: Long = 0L
    // null = unknown yet; used to only write locationStatus on actual transitions.
    private var lastLocationAvailable: Boolean? = null

    private val courierId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    private val activeDeliveryId: String
        get() = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTracking()
            ACTION_STOP -> stopTracking()
            else -> startTracking()
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startTracking() {
        startForeground(Constants.SHIFT_TRACKING_NOTIFICATION_ID, createNotification())

        // Idempotent (re)start: drop any previous callback first.
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            Constants.SHIFT_TRACK_UPDATE_INTERVAL
        ).apply {
            setMinUpdateIntervalMillis(Constants.SHIFT_TRACK_FASTEST_INTERVAL)
            setMinUpdateDistanceMeters(Constants.SHIFT_TRACK_MIN_DISPLACEMENT)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    recordBreadcrumb(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracy = location.accuracy,
                        speedKmh = if (location.hasSpeed()) location.speed * 3.6f else 0f
                    )
                }
            }

            override fun onLocationAvailability(availability: LocationAvailability) {
                updateLocationStatus(availability.isLocationAvailable)
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback!!,
            Looper.getMainLooper()
        )
    }

    private fun recordBreadcrumb(latitude: Double, longitude: Double, accuracy: Float, speedKmh: Float) {
        // A fix arrived, so location is available again (records the transition if
        // the courier had just re-enabled GPS).
        updateLocationStatus(true)

        val now = System.currentTimeMillis()
        if (now - lastWriteAt < Constants.SHIFT_TRACK_MIN_WRITE_INTERVAL) return
        lastWriteAt = now

        val uid = courierId
        if (uid.isEmpty()) return

        val deliveryId = activeDeliveryId
        val onMeter = deliveryId.isNotEmpty()
        val expireAt = now + Constants.TRACK_RETENTION_DAYS * 24L * 60L * 60L * 1000L

        serviceScope.launch {
            try {
                firestore.collection(Constants.COLLECTION_COURIER_TRACKS)
                    .document(uid)
                    .collection(Constants.SUBCOLLECTION_TRACK_POINTS)
                    .add(
                        mapOf(
                            "latitude" to latitude,
                            "longitude" to longitude,
                            "timestamp" to now,
                            "accuracy" to accuracy,
                            "speedKmh" to speedKmh,
                            "onMeter" to onMeter,
                            "deliveryId" to deliveryId,
                            // Firestore TTL deletes the point after this instant.
                            "expireAt" to com.google.firebase.Timestamp(java.util.Date(expireAt))
                        )
                    )
            } catch (_: Exception) {}

            // Keep the live-map position fresh even between orders.
            try {
                firestore.collection(Constants.COLLECTION_USERS)
                    .document(uid)
                    .update(
                        mapOf(
                            "lastLocation" to mapOf(
                                "latitude" to latitude,
                                "longitude" to longitude,
                                "timestamp" to now
                            )
                        )
                    )
            } catch (_: Exception) {}
        }
    }

    /**
     * Records whether the device is currently delivering location fixes. Written
     * only on transitions so the admin sees "геолокация отключена с HH:MM".
     */
    private fun updateLocationStatus(available: Boolean) {
        if (lastLocationAvailable == available) return
        lastLocationAvailable = available

        val uid = courierId
        if (uid.isEmpty()) return

        serviceScope.launch {
            try {
                firestore.collection(Constants.COLLECTION_USERS)
                    .document(uid)
                    .update(
                        mapOf(
                            "locationStatus" to mapOf(
                                "enabled" to available,
                                "since" to System.currentTimeMillis()
                            )
                        )
                    )
            } catch (_: Exception) {}
        }
    }

    private fun stopTracking() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = null
        lastLocationAvailable = null
        lastWriteAt = 0L
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, ZaKiApp.SHIFT_CHANNEL_ID)
            .setContentTitle("ZaKi")
            .setContentText("Вы на смене — отслеживание активно")
            .setSmallIcon(R.drawable.ic_delivery)
            .setColor(android.graphics.Color.parseColor("#3786F6"))
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "ZaKiTaksometr::ShiftTracking"
        ).apply { acquire() }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        releaseWakeLock()
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
    }

    companion object {
        const val ACTION_START = "ACTION_START_SHIFT_TRACKING"
        const val ACTION_STOP = "ACTION_STOP_SHIFT_TRACKING"

        fun start(context: Context) {
            val intent = Intent(context, ShiftTrackingService::class.java).apply {
                action = ACTION_START
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ShiftTrackingService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
