package com.zaki.taksometr.data.repository

import android.content.SharedPreferences
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.functions.FirebaseFunctions
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.DeliveryEntity
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.TodayStats
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeliveryRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val functions: FirebaseFunctions,
    private val deliveryDao: DeliveryDao,
    private val routePointDao: RoutePointDao,
    private val prefs: SharedPreferences
) : DeliveryRepository {

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    override suspend fun createDelivery(clientPhone: String): Resource<Delivery> {
        return try {
            // Call Cloud Function to create delivery (server-side validation)
            val data = hashMapOf(
                "courierId" to userId,
                "clientPhone" to clientPhone
            )

            val result = functions
                .getHttpsCallable("createDelivery")
                .call(data)
                .await()

            @Suppress("UNCHECKED_CAST")
            val responseData = result.data as Map<String, Any>
            val deliveryId = responseData["deliveryId"] as String

            val delivery = Delivery(
                id = deliveryId,
                courierId = userId,
                courierName = responseData["courierName"] as? String ?: "",
                clientPhone = clientPhone,
                status = DeliveryStatus.IN_PROGRESS,
                startTime = System.currentTimeMillis()
            )

            // Save locally
            deliveryDao.insert(DeliveryEntity.fromDelivery(delivery))

            // Save active delivery ID
            prefs.edit()
                .putString(Constants.PREF_ACTIVE_DELIVERY_ID, deliveryId)
                .apply()

            Resource.Success(delivery)
        } catch (e: Exception) {
            Resource.Error("Ошибка создания доставки: ${e.localizedMessage}")
        }
    }

    override suspend fun completeDelivery(deliveryId: String, waitingMinutes: Double): Resource<Delivery> {
        return try {
            // Get route points from local DB
            val points = routePointDao.getPointsByDeliveryIdSync(deliveryId)
            val routeData = points.map { point ->
                hashMapOf(
                    "latitude" to point.latitude,
                    "longitude" to point.longitude,
                    "timestamp" to point.timestamp,
                    "accuracy" to point.accuracy
                )
            }

            // Call Cloud Function to complete and calculate cost
            val data = hashMapOf(
                "deliveryId" to deliveryId,
                "courierId" to userId,
                "route" to routeData,
                "endTime" to System.currentTimeMillis(),
                "waitingMinutes" to waitingMinutes
            )

            val result = functions
                .getHttpsCallable("completeDelivery")
                .call(data)
                .await()

            @Suppress("UNCHECKED_CAST")
            val responseData = result.data as Map<String, Any>
            val cost = (responseData["cost"] as? Number)?.toDouble() ?: 0.0
            val distance = (responseData["distanceMeters"] as? Number)?.toDouble() ?: 0.0

            val delivery = Delivery(
                id = deliveryId,
                courierId = userId,
                clientPhone = responseData["clientPhone"] as? String ?: "",
                courierName = responseData["courierName"] as? String ?: "",
                status = DeliveryStatus.COMPLETED,
                startTime = (responseData["startTime"] as? Number)?.toLong() ?: 0L,
                endTime = System.currentTimeMillis(),
                distanceMeters = distance,
                cost = cost,
                route = points.map { it.toGeoPoint() }
            )

            // Update local DB
            deliveryDao.update(DeliveryEntity.fromDelivery(delivery).copy(isSynced = true))

            // Clear active delivery
            prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()

            Resource.Success(delivery)
        } catch (e: Exception) {
            Resource.Error("Ошибка завершения доставки: ${e.localizedMessage}")
        }
    }

    override suspend fun cancelDelivery(deliveryId: String): Resource<Unit> {
        return try {
            val data = hashMapOf(
                "deliveryId" to deliveryId,
                "courierId" to userId
            )
            functions.getHttpsCallable("cancelDelivery").call(data).await()

            // Update local
            val entity = deliveryDao.getById(deliveryId)
            entity?.let {
                deliveryDao.update(it.copy(status = DeliveryStatus.CANCELLED.name))
            }

            // Clear route points
            routePointDao.deleteByDeliveryId(deliveryId)
            prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()

            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error("Ошибка отмены доставки: ${e.localizedMessage}")
        }
    }

    override fun getActiveDelivery(): Flow<Delivery?> {
        return deliveryDao.getActiveDelivery(userId).map { it?.toDelivery() }
    }

    override fun getDeliveryHistory(courierId: String): Flow<List<Delivery>> {
        return deliveryDao.getDeliveriesByCourier(courierId).map { list ->
            list.map { it.toDelivery() }
        }
    }

    override fun searchDeliveries(phone: String): Flow<List<Delivery>> {
        return deliveryDao.searchByPhone(phone, userId).map { list ->
            list.map { it.toDelivery() }
        }
    }

    override fun getDeliveriesByDateRange(startDate: Long, endDate: Long): Flow<List<Delivery>> {
        return deliveryDao.getByDateRange(startDate, endDate, userId).map { list ->
            list.map { it.toDelivery() }
        }
    }

    override suspend fun getDeliveryById(deliveryId: String): Resource<Delivery> {
        return try {
            val entity = deliveryDao.getById(deliveryId)
            if (entity != null) {
                val points = routePointDao.getPointsByDeliveryIdSync(deliveryId)
                Resource.Success(entity.toDelivery().copy(route = points.map { it.toGeoPoint() }))
            } else {
                // Fetch from Firestore
                val doc = firestore.collection(Constants.COLLECTION_DELIVERIES)
                    .document(deliveryId)
                    .get()
                    .await()

                if (!doc.exists()) {
                    return Resource.Error("Доставка не найдена")
                }

                @Suppress("UNCHECKED_CAST")
                val routeList = doc.get("route") as? List<Map<String, Any>> ?: emptyList()
                val route = routeList.map { point ->
                    GeoPoint(
                        latitude = (point["latitude"] as? Number)?.toDouble() ?: 0.0,
                        longitude = (point["longitude"] as? Number)?.toDouble() ?: 0.0,
                        timestamp = (point["timestamp"] as? Number)?.toLong() ?: 0L,
                        accuracy = (point["accuracy"] as? Number)?.toFloat() ?: 0f
                    )
                }

                val delivery = Delivery(
                    id = doc.id,
                    courierId = doc.getString("courierId") ?: "",
                    courierName = doc.getString("courierName") ?: "",
                    clientPhone = doc.getString("clientPhone") ?: "",
                    status = DeliveryStatus.valueOf(doc.getString("status") ?: "COMPLETED"),
                    startTime = doc.getLong("startTime") ?: 0L,
                    endTime = doc.getLong("endTime"),
                    distanceMeters = doc.getDouble("distanceMeters") ?: 0.0,
                    cost = doc.getDouble("cost") ?: 0.0,
                    route = route,
                    createdAt = doc.getLong("createdAt") ?: 0L
                )
                Resource.Success(delivery)
            }
        } catch (e: Exception) {
            Resource.Error("Ошибка загрузки доставки: ${e.localizedMessage}")
        }
    }

    override suspend fun updateRoute(deliveryId: String, points: List<GeoPoint>) {
        // Route is saved locally via RoutePointDao, synced on completion
    }

    override suspend fun updateDistance(deliveryId: String, distanceMeters: Double) {
        val entity = deliveryDao.getById(deliveryId)
        entity?.let {
            deliveryDao.update(it.copy(distanceMeters = distanceMeters))
        }
    }

    override fun getTodayStats(courierId: String): Flow<TodayStats> {
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val todayStart = calendar.timeInMillis

        return combine(
            deliveryDao.getTodayDeliveryCount(courierId, todayStart),
            deliveryDao.getTodayEarnings(courierId, todayStart)
        ) { count, earnings ->
            TodayStats(deliveryCount = count, totalEarnings = earnings)
        }
    }
}
