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
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.RoutePointEntity
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.presentation.MainActivity
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.widget.TaksometrWidgetProvider
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@AndroidEntryPoint
class LocationTrackingService : Service() {

    @Inject lateinit var fusedLocationClient: FusedLocationProviderClient
    @Inject lateinit var routePointDao: RoutePointDao
    @Inject lateinit var deliveryDao: DeliveryDao
    @Inject lateinit var firestore: FirebaseFirestore
    @Inject lateinit var prefs: SharedPreferences
    @Inject lateinit var tariffRepository: TariffRepository

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null
    private var locationCallback: LocationCallback? = null
    private var lastValidPoint: GeoPoint? = null
    private var lastValidTimestamp: Long? = null
    private var totalDistance: Double = 0.0
    private var isMarketplaceOrder: Boolean = false
    private var startTime: Long = 0L
    private var clientPhone: String = ""
    private var widgetTimerJob: Job? = null

    private val deliveryId: String
        get() = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""

    private val courierId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTracking()
            ACTION_STOP -> stopTracking()
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startTracking() {
        val notification = createNotification("Отслеживание маршрута...")
        startForeground(Constants.TRACKING_NOTIFICATION_ID, notification)

        serviceScope.launch {
            val currentDeliveryId = deliveryId
            if (currentDeliveryId.isNotEmpty()) {
                deliveryDao.getById(currentDeliveryId)?.let { entity ->
                    startTime = entity.startTime
                    clientPhone = entity.clientPhone
                    isMarketplaceOrder = entity.orderKind == "MARKETPLACE"
                }
                val points = routePointDao.getPointsByDeliveryIdSync(currentDeliveryId)
                if (points.isNotEmpty()) {
                    val lastPoint = points.last()
                    lastValidPoint = lastPoint.toGeoPoint()
                    lastValidTimestamp = lastPoint.timestamp
                    val distancePoints = if (isMarketplaceOrder) {
                        val onTheWayAt = prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
                        if (onTheWayAt > 0) points.filter { it.timestamp >= onTheWayAt } else emptyList()
                    } else {
                        points
                    }
                    totalDistance = LocationUtils.calculateTotalDistance(distancePoints.map { it.toGeoPoint() })
                }
            }
            startWidgetTimer()
            sendImmediateLocationUpdateIfAvailable()
        }

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            Constants.LOCATION_UPDATE_INTERVAL
        ).apply {
            setMinUpdateIntervalMillis(Constants.LOCATION_FASTEST_INTERVAL)
            setWaitForAccurateLocation(true)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    val newPoint = GeoPoint(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        timestamp = System.currentTimeMillis(),
                        accuracy = location.accuracy
                    )
                    processLocationUpdate(newPoint)
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback!!,
            Looper.getMainLooper()
        )
    }

    @SuppressLint("MissingPermission")
    private suspend fun sendImmediateLocationUpdateIfAvailable() {
        if (courierId.isEmpty()) return

        try {
            val location = fusedLocationClient.lastLocation.await() ?: return
            updateCourierLocationInFirestore(
                GeoPoint(
                    latitude = location.latitude,
                    longitude = location.longitude,
                    timestamp = System.currentTimeMillis(),
                    accuracy = location.accuracy
                )
            )
        } catch (_: Exception) {}
    }

    private fun processLocationUpdate(newPoint: GeoPoint) {
        if (!LocationUtils.isValidPoint(newPoint, lastValidPoint, lastValidTimestamp)) {
            return
        }

        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) return

        lastValidPoint?.let { lastPoint ->
            val onTheWayAt = prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
            val shouldCountDistance = !isMarketplaceOrder || (onTheWayAt > 0 && newPoint.timestamp >= onTheWayAt)
            if (shouldCountDistance) {
                val increment = LocationUtils.haversineDistance(lastPoint, newPoint)
                totalDistance += increment
            }
        }

        lastValidPoint = newPoint
        lastValidTimestamp = newPoint.timestamp

        serviceScope.launch {
            routePointDao.insert(
                RoutePointEntity.fromGeoPoint(newPoint, currentDeliveryId)
            )

            deliveryDao.getById(currentDeliveryId)?.let { entity ->
                deliveryDao.update(entity.copy(distanceMeters = totalDistance))
            }

            updateCourierLocationInFirestore(newPoint)
        }

        val distanceText = LocationUtils.formatDistance(totalDistance)
        val notification = createNotification("Маршрут: $distanceText")
        val manager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(Constants.TRACKING_NOTIFICATION_ID, notification)
    }

    private var lastFirestoreUpdate = 0L

    private suspend fun updateCourierLocationInFirestore(point: GeoPoint) {
        val now = System.currentTimeMillis()
        if (now - lastFirestoreUpdate < 10000) return
        lastFirestoreUpdate = now

        try {
            firestore.collection(Constants.COLLECTION_USERS)
                .document(courierId)
                .update(
                    mapOf(
                        "lastLocation" to mapOf(
                            "latitude" to point.latitude,
                            "longitude" to point.longitude,
                            "timestamp" to point.timestamp
                        )
                    )
                )
                .await()
        } catch (_: Exception) {}
    }

    private fun startWidgetTimer() {
        widgetTimerJob?.cancel()
        widgetTimerJob = serviceScope.launch {
            while (isActive) {
                updateWidget()
                delay(1000)
            }
        }
    }

    private suspend fun updateWidget() {
        if (startTime == 0L) {
            deliveryDao.getById(deliveryId)?.let {
                startTime = it.startTime
                clientPhone = it.clientPhone
            }
        }
        val elapsed = if (startTime > 0) System.currentTimeMillis() - startTime else 0L
        val cost = tariffRepository.calculateCost(totalDistance)

        val widgetPrefs = getSharedPreferences(
            TaksometrWidgetProvider.WIDGET_PREFS, Context.MODE_PRIVATE
        )
        widgetPrefs.edit()
            .putBoolean(TaksometrWidgetProvider.KEY_ACTIVE, true)
            .putString(TaksometrWidgetProvider.KEY_DISTANCE, LocationUtils.formatDistance(totalDistance))
            .putString(TaksometrWidgetProvider.KEY_TIME, LocationUtils.formatDuration(elapsed))
            .putString(TaksometrWidgetProvider.KEY_COST, LocationUtils.formatCost(cost))
            .putString(TaksometrWidgetProvider.KEY_PHONE, clientPhone)
            .apply()

        TaksometrWidgetProvider.pushUpdate(applicationContext)
    }

    private fun clearWidget() {
        val widgetPrefs = getSharedPreferences(
            TaksometrWidgetProvider.WIDGET_PREFS, Context.MODE_PRIVATE
        )
        widgetPrefs.edit()
            .putBoolean(TaksometrWidgetProvider.KEY_ACTIVE, false)
            .apply()
        TaksometrWidgetProvider.pushUpdate(applicationContext)
    }

    private fun stopTracking() {
        widgetTimerJob?.cancel()
        clearWidget()
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
        }
        locationCallback = null
        lastValidPoint = null
        lastValidTimestamp = null
        totalDistance = 0.0
        startTime = 0L
        clientPhone = ""
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotification(contentText: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, ZaKiApp.TRACKING_CHANNEL_ID)
            .setContentTitle("ZaKi Taksometr")
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_delivery)
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
            "ZaKiTaksometr::LocationTracking"
        ).apply {
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        releaseWakeLock()
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
        }
    }

    companion object {
        const val ACTION_START = "ACTION_START_TRACKING"
        const val ACTION_STOP = "ACTION_STOP_TRACKING"

        fun startService(context: Context) {
            val intent = Intent(context, LocationTrackingService::class.java).apply {
                action = ACTION_START
            }
            context.startForegroundService(intent)
        }

        fun stopService(context: Context) {
            val intent = Intent(context, LocationTrackingService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
