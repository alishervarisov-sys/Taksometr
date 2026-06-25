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
import kotlinx.coroutines.flow.first
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

    override suspend fun createDelivery(clientPhone: String, deliveryType: String): Resource<Delivery> {
        return try {
            // Call Cloud Function to create delivery (server-side validation)
            val data = hashMapOf(
                "courierId" to userId,
                "clientPhone" to clientPhone,
                "deliveryType" to deliveryType
            )

            android.util.Log.d("DeliveryRepo", "=== SENDING TO FIREBASE ===")
            android.util.Log.d("DeliveryRepo", "Request data: $data")

            val result = functions
                .getHttpsCallable("createDelivery")
                .call(data)
                .await()

            @Suppress("UNCHECKED_CAST")
            val responseData = result.data as Map<String, Any>
            android.util.Log.d("DeliveryRepo", "createDelivery response: $responseData")
            
            val deliveryId = responseData["deliveryId"] as String
            val responseDeliveryType = responseData["deliveryType"] as? String ?: "default"
            val responseFixedPrice = (responseData["fixedPrice"] as? Number)?.toDouble()
            
            android.util.Log.d("DeliveryRepo", "Parsed - deliveryId: $deliveryId, type: $responseDeliveryType, price: $responseFixedPrice")

            val delivery = Delivery(
                id = deliveryId,
                courierId = userId,
                courierName = responseData["courierName"] as? String ?: "",
                clientPhone = clientPhone,
                status = DeliveryStatus.IN_PROGRESS,
                startTime = System.currentTimeMillis(),
                deliveryType = responseDeliveryType,
                fixedPrice = responseFixedPrice
            )
            
            android.util.Log.d("DeliveryRepo", "Created delivery object: $delivery")

            // Save locally
            deliveryDao.insert(DeliveryEntity.fromDelivery(delivery))

            // Save active delivery ID
            prefs.edit()
                .putString(Constants.PREF_ACTIVE_DELIVERY_ID, deliveryId)
                .apply()

            Resource.Success(delivery)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "Error creating delivery", e)
            Resource.Error("Ошибка создания доставки: ${e.localizedMessage}")
        }
    }

    override suspend fun getFixedDeliveryTypes(): Resource<Map<String, Double>> {
        return try {
            val doc = firestore.collection("tariffs")
                .document("default")
                .get()
                .await()

            if (!doc.exists()) {
                android.util.Log.d("DeliveryRepo", "Tariff document does not exist")
                return Resource.Success(emptyMap())
            }

            @Suppress("UNCHECKED_CAST")
            val fixedTypes = doc.get("fixedTypes") as? Map<String, Any> ?: emptyMap()
            
            android.util.Log.d("DeliveryRepo", "Loaded fixedTypes: $fixedTypes")
            
            val result = fixedTypes.mapValues { (_, value) ->
                when (value) {
                    is Number -> value.toDouble()
                    else -> 0.0
                }
            }
            
            android.util.Log.d("DeliveryRepo", "Converted result: $result")

            Resource.Success(result)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "Error loading tariffs", e)
            Resource.Error("Ошибка загрузки тарифов: ${e.localizedMessage}")
        }
    }

        override suspend fun completeDelivery(deliveryId: String, waitingMinutes: Double): Resource<Delivery> {
        android.util.Log.d("DeliveryRepo", "=== COMPLETE DELIVERY START ===")
        android.util.Log.d("DeliveryRepo", "deliveryId=$deliveryId")
        android.util.Log.d("DeliveryRepo", "waitingMinutes=$waitingMinutes")
        android.util.Log.d("DeliveryRepo", "userId=$userId")

        return try {
            // First check Firestore for the actual status of this delivery
            val firestoreDoc = firestore.collection(Constants.COLLECTION_DELIVERIES).document(deliveryId).get().await()
            if (firestoreDoc.exists()) {
                val firestoreStatus = firestoreDoc.getString("status") ?: "unknown"
                android.util.Log.d("DeliveryRepo", "Firestore delivery status: $firestoreStatus")
                
                if (firestoreStatus != "IN_PROGRESS") {
                    android.util.Log.e("DeliveryRepo", "Delivery status in Firestore is '$firestoreStatus', not 'IN_PROGRESS'")
                    
                    // If already completed on server, update local status
                    if (firestoreStatus == "COMPLETED") {
                        val cost = firestoreDoc.getDouble("cost") ?: 0.0
                        val distance = firestoreDoc.getDouble("distanceMeters") ?: 0.0
                        
                        // Update local DB to COMPLETED
                        val localEntity = deliveryDao.getById(deliveryId)
                        localEntity?.let {
                            deliveryDao.update(it.copy(
                                status = DeliveryStatus.COMPLETED.name,
                                cost = cost,
                                distanceMeters = distance,
                                endTime = firestoreDoc.getLong("endTime") ?: System.currentTimeMillis(),
                                isSynced = true
                            ))
                        }
                        
                        // Clear active delivery
                        prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()
                        
                        val delivery = Delivery(
                            id = deliveryId,
                            courierId = userId,
                            clientPhone = firestoreDoc.getString("clientPhone") ?: "",
                            courierName = firestoreDoc.getString("courierName") ?: "",
                            status = DeliveryStatus.COMPLETED,
                            startTime = firestoreDoc.getLong("startTime") ?: System.currentTimeMillis(),
                            endTime = firestoreDoc.getLong("endTime") ?: System.currentTimeMillis(),
                            distanceMeters = distance,
                            cost = cost
                        )
                        
                        android.util.Log.d("DeliveryRepo", "Delivery already completed on server. Synced locally.")
                        return Resource.Success(delivery)
                    }
                    
                    return Resource.Error(
                        "Доставка не в статусе 'В процессе' (статус на сервере: $firestoreStatus). " +
                        "Пожалуйста, обновите экран."
                    )
                }
            } else {
                android.util.Log.w("DeliveryRepo", "Delivery $deliveryId not found in Firestore!")
                return Resource.Error("Доставка не найдена на сервере. Возможно, она была удалена.")
            }

            // Get route points from local DB
            val points = routePointDao.getPointsByDeliveryIdSync(deliveryId)
            android.util.Log.d("DeliveryRepo", "Route points count: ${points.size}")
            
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

            android.util.Log.d("DeliveryRepo", "Calling completeDelivery cloud function...")
            android.util.Log.d("DeliveryRepo", "Request data: $data")

            val result = functions
                .getHttpsCallable("completeDelivery")
                .call(data)
                .await()

            @Suppress("UNCHECKED_CAST")
            val responseData = result.data as Map<String, Any>
            android.util.Log.d("DeliveryRepo", "completeDelivery response: $responseData")
            
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

            android.util.Log.d("DeliveryRepo", "=== COMPLETE DELIVERY SUCCESS ===")
            Resource.Success(delivery)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "=== COMPLETE DELIVERY ERROR ===")
            android.util.Log.e("DeliveryRepo", "Error: ${e.message}", e)
            
            // Check if this is a Firebase Functions error with a specific message
            val errorMessage = e.localizedMessage ?: e.message ?: "Неизвестная ошибка"
            
            Resource.Error("Ошибка завершения доставки: $errorMessage")
        }
    }

        override suspend fun cancelDelivery(deliveryId: String): Resource<Unit> {
        android.util.Log.d("DeliveryRepo", "=== CANCEL DELIVERY ===")
        android.util.Log.d("DeliveryRepo", "deliveryId=$deliveryId")
        
        return try {
            val data = hashMapOf(
                "deliveryId" to deliveryId,
                "courierId" to userId
            )
            android.util.Log.d("DeliveryRepo", "Calling cancelDelivery cloud function...")
            functions.getHttpsCallable("cancelDelivery").call(data).await()
            android.util.Log.d("DeliveryRepo", "cancelDelivery cloud function succeeded")

            // Update local
            val entity = deliveryDao.getById(deliveryId)
            entity?.let {
                android.util.Log.d("DeliveryRepo", "Updating local status to CANCELLED")
                deliveryDao.update(it.copy(status = DeliveryStatus.CANCELLED.name))
            }

            // Clear route points
            routePointDao.deleteByDeliveryId(deliveryId)
            prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()

            android.util.Log.d("DeliveryRepo", "=== CANCEL DELIVERY SUCCESS ===")
            Resource.Success(Unit)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "=== CANCEL DELIVERY ERROR ===")
            android.util.Log.e("DeliveryRepo", "Error: ${e.message}", e)
            Resource.Error("Ошибка отмены доставки: ${e.localizedMessage}")
        }
    }

    override fun getActiveDelivery(): Flow<Delivery?> {
        return deliveryDao.getActiveDelivery(userId).map { it?.toDelivery() }
    }

    override suspend fun syncRemoteActiveDelivery(): Resource<Delivery?> {
        return try {
            val snapshot = firestore.collection(Constants.COLLECTION_DELIVERIES)
                .whereEqualTo("courierId", userId)
                .whereEqualTo("status", "IN_PROGRESS")
                .limit(1)
                .get()
                .await()

            val doc = snapshot.documents.firstOrNull()
            if (doc == null) {
                return Resource.Success(null)
            }

            val delivery = doc.toDeliveryModel()
            deliveryDao.insert(DeliveryEntity.fromDelivery(delivery).copy(isSynced = true))
            prefs.edit()
                .putString(Constants.PREF_ACTIVE_DELIVERY_ID, delivery.id)
                .remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID)
                .apply()
            Resource.Success(delivery)
        } catch (e: Exception) {
            Resource.Error("Ошибка синхронизации заказа: ${e.localizedMessage}")
        }
    }

    private suspend fun fetchDeliveryById(deliveryId: String): Resource<Delivery> {
        return try {
            val doc = firestore.collection(Constants.COLLECTION_DELIVERIES)
                .document(deliveryId)
                .get()
                .await()

            if (!doc.exists()) {
                return Resource.Error("Заказ не найден после принятия")
            }

            val delivery = doc.toDeliveryModel()
            if (delivery.courierId != userId || delivery.status != DeliveryStatus.IN_PROGRESS) {
                return Resource.Error("Заказ не стал активным для текущего курьера")
            }

            deliveryDao.insert(DeliveryEntity.fromDelivery(delivery).copy(isSynced = true))
            prefs.edit()
                .putString(Constants.PREF_ACTIVE_DELIVERY_ID, delivery.id)
                .remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID)
                .apply()

            Resource.Success(delivery)
        } catch (e: Exception) {
            Resource.Error("Ошибка загрузки принятого заказа: ${e.localizedMessage}")
        }
    }

    override suspend fun acceptMarketplaceDelivery(deliveryId: String): Resource<Delivery> {
        return try {
            functions.getHttpsCallable("acceptMarketplaceDelivery")
                .call(hashMapOf(
                    "deliveryId" to deliveryId,
                    "courierId" to userId
                ))
                .await()

            val fetched = fetchDeliveryById(deliveryId)
            when (fetched) {
                is Resource.Success -> Resource.Success(fetched.data!!)
                is Resource.Error -> fetched
                is Resource.Loading -> Resource.Error("Не удалось загрузить принятый заказ")
            }
        } catch (e: Exception) {
            Resource.Error("Ошибка принятия заказа: ${e.localizedMessage}")
        }
    }

    override suspend fun updateMarketplaceDeliveryStage(
        deliveryId: String,
        stage: String?,
        waitingAction: String?
    ): Resource<Unit> {
        return try {
            val data = hashMapOf<String, Any>(
                "deliveryId" to deliveryId,
                "courierId" to userId
            )
            if (stage != null) data["stage"] = stage
            if (waitingAction != null) data["waitingAction"] = waitingAction

            functions.getHttpsCallable("updateMarketplaceDeliveryStage")
                .call(data)
                .await()

            val current = deliveryDao.getById(deliveryId)
            current?.let {
                deliveryDao.update(it.copy(
                    adminOrderStage = stage ?: it.adminOrderStage,
                    waitingStartedAt = when (waitingAction) {
                        "START" -> System.currentTimeMillis()
                        "STOP" -> null
                        else -> it.waitingStartedAt
                    }
                ))
            }
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error("Ошибка обновления статуса заказа: ${e.localizedMessage}")
        }
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

                val delivery = doc.toDeliveryModel().copy(route = route)
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

    override suspend fun syncDeliveryStatusFromFirestore(deliveryId: String): Resource<Delivery?> {
        android.util.Log.d("DeliveryRepo", "=== SYNC DELIVERY STATUS ===")
        android.util.Log.d("DeliveryRepo", "deliveryId=$deliveryId")
        
        return try {
            val doc = firestore.collection(Constants.COLLECTION_DELIVERIES)
                .document(deliveryId)
                .get()
                .await()
            
            if (!doc.exists()) {
                android.util.Log.w("DeliveryRepo", "Delivery $deliveryId not found in Firestore!")
                // Delete from local and clear prefs
                deliveryDao.deleteById(deliveryId)
                prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()
                return Resource.Success(null)
            }
            
            val firestoreStatus = doc.getString("status") ?: "COMPLETED"
            android.util.Log.d("DeliveryRepo", "Firestore status: $firestoreStatus")
            
            val localEntity = deliveryDao.getById(deliveryId)
            
            if (firestoreStatus != "IN_PROGRESS" && localEntity?.status == "IN_PROGRESS") {
                // Stale delivery - update local
                android.util.Log.d("DeliveryRepo", "Local status is stale. Updating to: $firestoreStatus")
                
                deliveryDao.update(localEntity.copy(
                    status = firestoreStatus,
                    cost = doc.getDouble("cost") ?: localEntity.cost,
                    distanceMeters = doc.getDouble("distanceMeters") ?: localEntity.distanceMeters,
                    endTime = doc.getLong("endTime"),
                    isSynced = true
                ))
                
                // Clear active delivery
                prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()
            }
            
            val delivery = if (doc.exists()) {
                val routeList = doc.get("route") as? List<Map<String, Any>> ?: emptyList()
                val route = routeList.map { point ->
                    GeoPoint(
                        latitude = (point["latitude"] as? Number)?.toDouble() ?: 0.0,
                        longitude = (point["longitude"] as? Number)?.toDouble() ?: 0.0,
                        timestamp = (point["timestamp"] as? Number)?.toLong() ?: 0L,
                        accuracy = (point["accuracy"] as? Number)?.toFloat() ?: 0f
                    )
                }

                doc.toDeliveryModel().copy(route = route)
            } else null
            
            android.util.Log.d("DeliveryRepo", "=== SYNC COMPLETE ===")
            Resource.Success(delivery)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "Error syncing delivery status: ${e.message}")
            Resource.Error("Ошибка синхронизации статуса: ${e.localizedMessage}")
        }
    }

    override suspend fun clearStaleActiveDelivery() {
        android.util.Log.d("DeliveryRepo", "=== CLEAR STALE ACTIVE DELIVERY ===")
        try {
            val activeId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "")
            if (!activeId.isNullOrEmpty()) {
                val result = syncDeliveryStatusFromFirestore(activeId)
                if (result is Resource.Success && (result.data == null || result.data?.status != DeliveryStatus.IN_PROGRESS)) {
                    deliveryDao.deleteById(activeId)
                    routePointDao.deleteByDeliveryId(activeId)
                    prefs.edit().remove(Constants.PREF_ACTIVE_DELIVERY_ID).apply()
                    android.util.Log.d("DeliveryRepo", "Cleared stale active delivery: $activeId")
                }
            }

            val remote = syncRemoteActiveDelivery()
            if (remote is Resource.Success && remote.data != null) {
                android.util.Log.d("DeliveryRepo", "Synced remote active delivery: ${remote.data.id}")
            }
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "Error clearing stale delivery: ${e.message}")
        }
    }

    private fun com.google.firebase.firestore.DocumentSnapshot.toDeliveryModel(): Delivery {
        val routeList = get("route") as? List<Map<String, Any>> ?: emptyList()
        val route = routeList.map { point ->
            GeoPoint(
                latitude = (point["latitude"] as? Number)?.toDouble() ?: 0.0,
                longitude = (point["longitude"] as? Number)?.toDouble() ?: 0.0,
                timestamp = (point["timestamp"] as? Number)?.toLong() ?: 0L,
                accuracy = (point["accuracy"] as? Number)?.toFloat() ?: 0f
            )
        }

        return Delivery(
            id = id,
            courierId = getString("courierId") ?: "",
            courierName = getString("courierName") ?: "",
            clientPhone = getString("clientPhone") ?: "",
            status = DeliveryStatus.valueOf(getString("status") ?: "IN_PROGRESS"),
            startTime = getLong("startTime") ?: 0L,
            endTime = getLong("endTime"),
            distanceMeters = getDouble("distanceMeters") ?: 0.0,
            cost = getDouble("cost") ?: 0.0,
            route = route,
            deliveryType = getString("deliveryType") ?: "default",
            fixedPrice = getDouble("fixedPrice"),
            createdAt = getLong("createdAt") ?: 0L,
            orderKind = getString("orderKind") ?: "REGULAR",
            adminOrderStage = getString("adminOrderStage"),
            comment = getString("comment") ?: "",
            pickupAddress = (get("pickup") as? Map<*, *>)?.get("address") as? String ?: "",
            pickupLat = ((get("pickup") as? Map<*, *>)?.get("latitude") as? Number)?.toDouble(),
            pickupLng = ((get("pickup") as? Map<*, *>)?.get("longitude") as? Number)?.toDouble(),
            destinationAddress = (get("destination") as? Map<*, *>)?.get("address") as? String ?: "",
            destinationLat = ((get("destination") as? Map<*, *>)?.get("latitude") as? Number)?.toDouble(),
            destinationLng = ((get("destination") as? Map<*, *>)?.get("longitude") as? Number)?.toDouble(),
            waitingMinutes = getDouble("waitingMinutes") ?: 0.0,
            waitingStartedAt = getLong("waitingStartedAt"),
            courierPhone = getString("courierPhone") ?: ""
        )
    }
}
