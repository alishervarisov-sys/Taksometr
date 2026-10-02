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
import com.zaki.taksometr.data.local.dao.PendingOperationDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.PendingOperationEntity
import com.zaki.taksometr.data.local.entity.RoutePointEntity
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.presentation.MainActivity
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.Resource
import com.zaki.taksometr.widget.TaksometrWidgetProvider
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import java.lang.ref.WeakReference

@AndroidEntryPoint
class LocationTrackingService : Service() {

    @Inject lateinit var fusedLocationClient: FusedLocationProviderClient
    @Inject lateinit var routePointDao: RoutePointDao
    @Inject lateinit var deliveryDao: DeliveryDao
    @Inject lateinit var firestore: FirebaseFirestore
    @Inject lateinit var prefs: SharedPreferences
    @Inject lateinit var tariffRepository: TariffRepository
    @Inject lateinit var deliveryRepository: DeliveryRepository
    @Inject lateinit var pendingOperationDao: PendingOperationDao

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null
    private var locationCallback: LocationCallback? = null
    private var lastValidPoint: GeoPoint? = null
    private var lastValidTimestamp: Long? = null
    private var loadedDeliveryId: String? = null
    private var deliveryStateJob: Job? = null
    private var stateReady = false
    private var totalDistance: Double = 0.0
    private var isMarketplaceOrder: Boolean = false
    // When true, the next recorded point re-anchors the meter after a switch/resume
    // and is stored as a gap so the jump from the pause location isn't counted.
    private var pendingGapAnchor: Boolean = false
    // When true, the current delivery is explicitly paused: we keep reporting the
    // courier's location (for the admin map) but freeze distance/route recording.
    private var paused: Boolean = false
    private var startTime: Long = 0L
    private var clientPhone: String = ""
    private var currentDeliveryType: String = "default"
    private var widgetTimerJob: Job? = null
    private var currentSpeedKmh: Float = 0f
    private var maxSpeedKmh: Float = 0f
    private var lastDeliverySpeedUpdate = 0L
    @Volatile private var autoPickupInFlightForId: String? = null

    private val deliveryId: String
        get() = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""

    private val courierId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            TrackingController.clearPending(this, TrackingKind.DELIVERY)
            stopTracking()
            return START_NOT_STICKY
        }
        if (intent != null && intent.action !in listOf(ACTION_START, ACTION_SWITCH)) {
            stopTracking()
            return START_NOT_STICKY
        }
        val source = TrackingController.source(intent)
        if (!TrackingController.isNeeded(this, TrackingKind.DELIVERY)) {
            TrackingController.clearPending(this, TrackingKind.DELIVERY)
            stopTracking()
            return START_NOT_STICKY
        }
        return try {
            // A null intent is an OS sticky restart and must restore GPS too.
            val started = if (locationCallback != null && TrackingController.hasLocation(this)) {
                if (intent?.action == ACTION_SWITCH || loadedDeliveryId != deliveryId) switchTracking()
                true
            } else startTracking(source)
            if (started) START_STICKY else START_NOT_STICKY
        } catch (e: SecurityException) {
            failTracking(source, e)
            START_NOT_STICKY
        } catch (e: IllegalStateException) {
            failTracking(source, e)
            START_NOT_STICKY
        }
    }

    @SuppressLint("MissingPermission")
    private fun startTracking(source: TrackingStartSource = TrackingStartSource.VISIBLE_APP): Boolean {
        val notification = createNotification("Отслеживание маршрута...")
        if (!TrackingController.promote(this, TrackingKind.DELIVERY, source,
                Constants.TRACKING_NOTIFICATION_ID, notification)) {
            stopTracking()
            return false
        }
        runningService = WeakReference(this)
        if (wakeLock == null) acquireWakeLock()

        // Load the state of whichever delivery is currently active (gap-aware).
        loadCurrentDeliveryState(source)

        // Make (re)starting idempotent: drop any previous callback before
        // registering a new one so we never accumulate duplicate location streams.
        locationCallback?.let { runCatching { fusedLocationClient.removeLocationUpdates(it) } }

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            Constants.LOCATION_UPDATE_INTERVAL
        ).apply {
            setMinUpdateIntervalMillis(Constants.LOCATION_FASTEST_INTERVAL)
            setWaitForAccurateLocation(true)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                if (locationCallback !== this || !stateReady) return
                result.lastLocation?.let { location ->
                    if (location.hasSpeed() && location.speed >= 0f) {
                        val speedKmh = location.speed * 3.6f
                        currentSpeedKmh = speedKmh
                        if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh
                    }
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

        val callback = locationCallback!!
        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            callback,
            Looper.getMainLooper()
        ).addOnSuccessListener {
            if (locationCallback === callback) TrackingController.clearPending(this, TrackingKind.DELIVERY)
        }.addOnFailureListener { error ->
            if (locationCallback === callback) failTracking(source, error)
        }
        return true
    }

    private fun failTracking(source: TrackingStartSource, error: Exception) {
        TrackingController.defer(this, TrackingKind.DELIVERY, source, "location_updates_failed", error)
        stopTracking()
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

    /**
     * Re-initialises the tracked delivery (whichever is now in
     * PREF_ACTIVE_DELIVERY_ID) without stopping the running location updates.
     * Used when the courier switches/resumes between concurrent deliveries.
     * The paused delivery's distance is frozen because we stop recording points
     * for it, and the next point for the resumed delivery is anchored as a gap so
     * the travel done while it was paused isn't counted.
     */
    private fun switchTracking(source: TrackingStartSource = TrackingStartSource.VISIBLE_APP) {
        if (deliveryId.isEmpty()) {
            stopTracking()
            return
        }
        // Location updates are already running; just re-anchor to the new current
        // delivery. If they are not running (edge case), fall back to a full start.
        if (locationCallback == null) {
            startTracking(source)
        } else {
            loadCurrentDeliveryState(source)
        }
    }

    /**
     * Loads the state for the delivery in PREF_ACTIVE_DELIVERY_ID and re-anchors
     * the meter. The paused delivery's distance is frozen because we stop
     * recording points for it; the first point after (re)starting/resuming a
     * delivery that already has recorded points is marked as a gap so the jump
     * from the pause/interruption location isn't counted.
     */
    private fun loadCurrentDeliveryState(source: TrackingStartSource) {
        val currentDeliveryId = deliveryId
        loadedDeliveryId = currentDeliveryId
        stateReady = false
        deliveryStateJob?.cancel()
        widgetTimerJob?.cancel()
        // GPS callbacks and restored meter state are committed on the same thread.
        // Do not accept fixes before the gap anchor and stored distance are ready.
        deliveryStateJob = serviceScope.launch(Dispatchers.Main.immediate) {
            try {
                lastValidPoint = null
                lastValidTimestamp = null
                currentSpeedKmh = 0f
                maxSpeedKmh = 0f
                totalDistance = 0.0
                pendingGapAnchor = false

                if (currentDeliveryId.isNotEmpty()) {
                    val entity = deliveryDao.getById(currentDeliveryId)
                    if (entity == null) {
                        TrackingController.defer(this@LocationTrackingService, TrackingKind.DELIVERY,
                            source, "waiting_for_delivery_state")
                        stopTracking()
                        return@launch
                    }
                    if (entity.status != "IN_PROGRESS") {
                        TrackingController.clearPending(this@LocationTrackingService, TrackingKind.DELIVERY)
                        stopTracking()
                        return@launch
                    }
                    entity.let {
                        startTime = entity.startTime
                        clientPhone = entity.clientPhone
                        isMarketplaceOrder = entity.orderKind == "MARKETPLACE"
                        currentDeliveryType = entity.deliveryType
                        // Restore the explicit pause state so it survives app/service restarts.
                        paused = entity.isPaused
                    }
                    val points = routePointDao.getPointsByDeliveryIdSync(currentDeliveryId)
                    val distancePoints = if (isMarketplaceOrder) {
                        val onTheWayAt = prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
                        if (onTheWayAt > 0) points.filter { it.timestamp >= onTheWayAt } else emptyList()
                    } else {
                        points
                    }
                    totalDistance = withContext(Dispatchers.IO) {
                        LocationUtils.calculateTotalDistance(distancePoints.map { it.toGeoPoint() })
                    }
                    // Continue an existing route with a gap anchor so interrupted travel
                    // (app restart, pause/switch) isn't wrongly added to this delivery.
                    pendingGapAnchor = points.isNotEmpty()
                }

                ensureActive()
                if (currentDeliveryId != deliveryId) return@launch
                stateReady = true
                startWidgetTimer()
                sendImmediateLocationUpdateIfAvailable()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                TrackingController.defer(this@LocationTrackingService, TrackingKind.DELIVERY,
                    source, "state_restore_failed", e)
                stopTracking()
            }
        }
    }

    private fun processLocationUpdate(newPoint: GeoPoint) {
        // While explicitly paused, keep the courier visible on the admin map but
        // freeze the meter: don't record route points or accumulate distance.
        if (paused) {
            serviceScope.launch { updateCourierLocationInFirestore(newPoint) }
            return
        }

        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) return
        // Check every accurate fix, including stationary ones that the route
        // recorder discards. The courier may already be standing at pickup.
        maybeStartMarketplaceTrip(currentDeliveryId, newPoint)

        if (!LocationUtils.isValidPoint(newPoint, lastValidPoint, lastValidTimestamp)) {
            return
        }

        val isGapAnchor = pendingGapAnchor
        if (!isGapAnchor) {
            lastValidPoint?.let { lastPoint ->
                val onTheWayAt = prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
                val shouldCountDistance = !isMarketplaceOrder || (onTheWayAt > 0 && newPoint.timestamp >= onTheWayAt)
                if (shouldCountDistance) {
                    val increment = LocationUtils.haversineDistance(lastPoint, newPoint)
                    totalDistance += increment
                }
            }
        }
        // The gap anchor is consumed by this first post-resume point.
        pendingGapAnchor = false

        lastValidPoint = newPoint
        lastValidTimestamp = newPoint.timestamp

        val pointToStore = if (isGapAnchor) newPoint.copy(isGap = true) else newPoint

        serviceScope.launch {
            routePointDao.insert(
                RoutePointEntity.fromGeoPoint(pointToStore, currentDeliveryId)
            )

            deliveryDao.getById(currentDeliveryId)?.let { entity ->
                deliveryDao.update(entity.copy(distanceMeters = totalDistance))
            }

            updateCourierLocationInFirestore(newPoint)
            updateDeliveryMeterInFirestore(currentDeliveryId)
        }

        val distanceText = LocationUtils.formatDistance(totalDistance)
        val notification = createNotification("Маршрут: $distanceText")
        val manager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(Constants.TRACKING_NOTIFICATION_ID, notification)
    }

    private fun maybeStartMarketplaceTrip(currentDeliveryId: String, point: GeoPoint) {
        val isStationaryFix = lastValidPoint?.let {
            LocationUtils.haversineDistance(it, point) < 5.0
        } ?: false
        if (point.accuracy > 20f ||
            (!isStationaryFix && !LocationUtils.isValidPoint(point, lastValidPoint, lastValidTimestamp)) ||
            autoPickupInFlightForId == currentDeliveryId
        ) return
        autoPickupInFlightForId = currentDeliveryId
        serviceScope.launch {
            try {
                val order = deliveryDao.getById(currentDeliveryId)
                val pickupLat = order?.pickupLat
                val pickupLng = order?.pickupLng
                if (currentDeliveryId != deliveryId || order?.orderKind != "MARKETPLACE" ||
                    order.status != "IN_PROGRESS" || order.isPaused ||
                    order.adminOrderStage !in listOf(null, "ACCEPTED") ||
                    pickupLat == null || pickupLng == null
                ) return@launch

                val distance = LocationUtils.haversineDistance(
                    point, GeoPoint(pickupLat, pickupLng)
                )
                if (currentDeliveryId == deliveryId && distance <= Constants.PICKUP_ARRIVAL_RADIUS_METERS) {
                    when (val result = deliveryRepository.updateMarketplaceDeliveryStage(
                        currentDeliveryId, "ON_THE_WAY", null
                    )) {
                        is Resource.Error -> android.util.Log.w(
                            "LocationTrackingService",
                            "Could not auto-start trip $currentDeliveryId: ${result.message}"
                        )
                        else -> Unit
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("LocationTrackingService", "Pickup geofence check failed", e)
            } finally {
                autoPickupInFlightForId = null
            }
        }
    }

    private var lastFirestoreUpdate = 0L

    private suspend fun updateDeliveryMeterInFirestore(currentDeliveryId: String) {
        val now = System.currentTimeMillis()
        if (now - lastDeliverySpeedUpdate < 10000) return
        lastDeliverySpeedUpdate = now
        if (currentDeliveryId.isEmpty()) return
        try {
            // Live meter cost the courier currently sees on the counter. Pushed so
            // that if an admin completes the order, the accrued amount (e.g. 16.30)
            // is used instead of a recalculated base price.
            val liveCost = tariffRepository.calculateCost(totalDistance, currentDeliveryType)
            firestore.collection(Constants.COLLECTION_DELIVERIES)
                .document(currentDeliveryId)
                .update(
                    mapOf(
                        "currentSpeedKmh" to currentSpeedKmh,
                        "maxSpeedKmh" to maxSpeedKmh,
                        "distanceMeters" to totalDistance,
                        "liveCost" to liveCost
                    )
                )
                .await()
        } catch (_: Exception) {}
    }

    private suspend fun updateCourierLocationInFirestore(point: GeoPoint) {
        val now = System.currentTimeMillis()
        if (now - lastFirestoreUpdate < 10000) return
        lastFirestoreUpdate = now

        val cId = courierId
        if (cId.isEmpty()) return

        // Offline: buffer the latest position in the pending-operations queue
        // (single REPLACE row) instead of silently dropping it. It is pushed to
        // Firestore by OperationSyncWorker once the network is back.
        if (!isNetworkAvailable()) {
            try {
                pendingOperationDao.insert(
                    PendingOperationEntity(
                        id = PendingOperationEntity.LOCATION_OP_ID,
                        type = PendingOperationEntity.TYPE_COURIER_LOCATION,
                        payload = org.json.JSONObject()
                            .put("courierId", cId)
                            .put("latitude", point.latitude)
                            .put("longitude", point.longitude)
                            .put("timestamp", point.timestamp)
                            .toString()
                    )
                )
            } catch (_: Exception) {}
            return
        }

        try {
            firestore.collection(Constants.COLLECTION_USERS)
                .document(cId)
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
        } catch (e: Exception) {
            // Network dropped mid-call — buffer for later replay.
            try {
                pendingOperationDao.insert(
                    PendingOperationEntity(
                        id = PendingOperationEntity.LOCATION_OP_ID,
                        type = PendingOperationEntity.TYPE_COURIER_LOCATION,
                        payload = org.json.JSONObject()
                            .put("courierId", cId)
                            .put("latitude", point.latitude)
                            .put("longitude", point.longitude)
                            .put("timestamp", point.timestamp)
                            .toString()
                    )
                )
            } catch (_: Exception) {}
        }
    }

    private fun isNetworkAvailable(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
                ?: return false
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Exception) {
            false
        }
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
                currentDeliveryType = it.deliveryType
            }
        }
        val elapsed = if (startTime > 0) System.currentTimeMillis() - startTime else 0L
        val cost = tariffRepository.calculateCost(totalDistance, currentDeliveryType)

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
        if (runningService?.get() === this) runningService = null
        stateReady = false
        deliveryStateJob?.cancel()
        widgetTimerJob?.cancel()
        clearWidget()
        locationCallback?.let {
            runCatching { fusedLocationClient.removeLocationUpdates(it) }
        }
        locationCallback = null
        lastValidPoint = null
        lastValidTimestamp = null
        totalDistance = 0.0
        pendingGapAnchor = false
        paused = false
        startTime = 0L
        clientPhone = ""
        currentSpeedKmh = 0f
        maxSpeedKmh = 0f
        lastDeliverySpeedUpdate = 0L
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

        val largeIcon = android.graphics.BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)

        return NotificationCompat.Builder(this, ZaKiApp.TRACKING_CHANNEL_ID)
            .setContentTitle("ZaKi")
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_delivery)
            .apply { largeIcon?.let { setLargeIcon(it) } }
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
        if (runningService?.get() === this) runningService = null
        stateReady = false
        widgetTimerJob?.cancel()
        serviceScope.cancel()
        releaseWakeLock()
        locationCallback?.let {
            runCatching { fusedLocationClient.removeLocationUpdates(it) }
        }
        locationCallback = null
    }

    companion object {
        @Volatile private var runningService: WeakReference<LocationTrackingService>? = null
        const val ACTION_START = "ACTION_START_TRACKING"
        const val ACTION_STOP = "ACTION_STOP_TRACKING"
        const val ACTION_SWITCH = "ACTION_SWITCH_TRACKING"

        fun startService(context: Context, source: TrackingStartSource = TrackingStartSource.VISIBLE_APP) {
            TrackingController.onMain {
                val service = runningService?.get()
                if (service != null && TrackingController.isNeeded(context, TrackingKind.DELIVERY) &&
                    TrackingController.hasLocation(context)) {
                    if (service.loadedDeliveryId != service.deliveryId) service.switchTracking()
                    return@onMain
                }
                service?.stopTracking()
                TrackingController.launch(context, TrackingKind.DELIVERY, ACTION_START, source)
            }
        }

        fun stopService(context: Context) {
            TrackingController.onMain {
                TrackingController.clearPending(context, TrackingKind.DELIVERY)
                runningService?.get()?.stopTracking()
                context.stopService(Intent(context, LocationTrackingService::class.java))
            }
        }

        /**
         * Re-anchor tracking to the delivery currently stored in
         * PREF_ACTIVE_DELIVERY_ID. Call after switching/resuming between orders.
         */
        fun switchService(context: Context) {
            TrackingController.onMain {
                val service = runningService?.get()
                if (service != null) service.switchTracking()
                else TrackingController.launch(context, TrackingKind.DELIVERY, ACTION_SWITCH, TrackingStartSource.VISIBLE_APP)
            }
        }

        /** Push messages may refresh an existing tracker, never create one from the background. */
        fun refreshFromPush(context: Context) {
            TrackingController.onMain {
                val service = runningService?.get()
                if (service != null) service.switchTracking(TrackingStartSource.PUSH)
                else TrackingController.defer(context, TrackingKind.DELIVERY, TrackingStartSource.PUSH, "push_waiting_for_app")
            }
        }
    }
}
