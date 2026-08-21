package com.zaki.taksometr.data.repository

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Looper
import com.google.android.gms.location.*
import com.google.firebase.firestore.FirebaseFirestore
import com.zaki.taksometr.data.local.dao.PendingOperationDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.PendingOperationEntity
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.LocationRepository
import com.zaki.taksometr.service.OperationSyncWorker
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LocationRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val fusedLocationClient: FusedLocationProviderClient,
    private val routePointDao: RoutePointDao,
    private val firestore: FirebaseFirestore,
    private val pendingOperationDao: PendingOperationDao
) : LocationRepository {

    private fun isNetworkAvailable(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Exception) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    override fun getLocationUpdates(): Flow<GeoPoint> = callbackFlow {
        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            Constants.LOCATION_UPDATE_INTERVAL
        ).apply {
            setMinUpdateIntervalMillis(Constants.LOCATION_FASTEST_INTERVAL)
            setMinUpdateDistanceMeters(Constants.LOCATION_MIN_DISPLACEMENT)
        }.build()

        val locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    val point = GeoPoint(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        timestamp = System.currentTimeMillis(),
                        accuracy = location.accuracy
                    )
                    trySend(point)
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback,
            Looper.getMainLooper()
        )

        awaitClose {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }
    }

    override fun getRoutePoints(): Flow<List<GeoPoint>> {
        return routePointDao.getPointsByDeliveryId("").map { entities ->
            entities.map { it.toGeoPoint() }
        }
    }

    override suspend fun saveRoutePoint(point: GeoPoint) {
        // This is handled by the service with delivery ID context
    }

    override suspend fun clearRoute() {
        // Handled per delivery
    }

    override fun getTotalDistance(): Flow<Double> {
        return routePointDao.getPointsByDeliveryId("").map { points ->
            LocationUtils.calculateTotalDistance(points.map { it.toGeoPoint() })
        }
    }

    override suspend fun updateCourierLocation(courierId: String, point: GeoPoint) {
        if (courierId.isEmpty()) return
        // Offline: buffer the position in the pending-operations queue; it is
        // pushed to Firestore by OperationSyncWorker once the network is back.
        if (!isNetworkAvailable()) {
            try {
                pendingOperationDao.insert(
                    PendingOperationEntity(
                        id = PendingOperationEntity.LOCATION_OP_ID,
                        type = PendingOperationEntity.TYPE_COURIER_LOCATION,
                        payload = JSONObject()
                            .put("courierId", courierId)
                            .put("latitude", point.latitude)
                            .put("longitude", point.longitude)
                            .put("timestamp", point.timestamp)
                            .toString()
                    )
                )
                OperationSyncWorker.schedule(context)
            } catch (_: Exception) {}
            return
        }
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
        } catch (_: Exception) {
            // Silently fail - location update is not critical
        }
    }

    @SuppressLint("MissingPermission")
    override suspend fun getCurrentLocation(): GeoPoint? {
        return try {
            fusedLocationClient.lastLocation.await()?.let { location ->
                GeoPoint(
                    latitude = location.latitude,
                    longitude = location.longitude,
                    timestamp = System.currentTimeMillis(),
                    accuracy = location.accuracy
                )
            } ?: getLocationUpdates().first()
        } catch (_: Exception) {
            null
        }
    }
}

