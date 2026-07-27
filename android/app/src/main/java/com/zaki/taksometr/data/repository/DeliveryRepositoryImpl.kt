package com.zaki.taksometr.data.repository

import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.functions.FirebaseFunctions
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.PendingCompletionDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.DeliveryEntity
import com.zaki.taksometr.data.local.entity.PendingCompletionEntity
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.domain.repository.TodayStats
import com.zaki.taksometr.service.CompletionSyncWorker
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.qualifiers.ApplicationContext
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
    @ApplicationContext private val context: Context,
    private val firestore: FirebaseFirestore,
    private val functions: FirebaseFunctions,
    private val deliveryDao: DeliveryDao,
    private val routePointDao: RoutePointDao,
    private val pendingCompletionDao: PendingCompletionDao,
    private val tariffRepository: TariffRepository,
    private val prefs: SharedPreferences
) : DeliveryRepository {

    /** True when the device currently has a usable (validated) internet connection. */
    private fun isNetworkAvailable(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (e: Exception) {
            false
        }
    }

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

            // Make this the current (running) delivery; freezes the meter of the
            // previously-current one if the courier already had an active order.
            makeCurrent(deliveryId)

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

        // Offline: don't fail the courier. Queue the completion locally with a
        // best-effort cost estimate and finalize it on the server later via
        // CompletionSyncWorker as soon as the network is back.
        if (!isNetworkAvailable()) {
            android.util.Log.w("DeliveryRepo", "No network — queueing completion offline")
            return enqueueOfflineCompletion(deliveryId, waitingMinutes)
        }

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
                        
                        // Switch to remaining active (paused) delivery if any, else clear.
                        switchToRemainingActiveOrClear(deliveryId)
                        
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

            // For MARKETPLACE orders only count route from ON_THE_WAY stage.
            // Prefer the per-delivery timestamp; fall back to the legacy global
            // pref for orders that reached ON_THE_WAY before this update.
            val completingEntity = deliveryDao.getById(deliveryId)
            val isMarketplace = completingEntity?.orderKind == "MARKETPLACE"
            val onTheWayAt = completingEntity?.onTheWayStartedAt
                ?: prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
            val routePoints = if (isMarketplace && onTheWayAt > 0) {
                points.filter { it.timestamp >= onTheWayAt }
            } else {
                points
            }
            android.util.Log.d("DeliveryRepo", "Route points for cost (filtered): ${routePoints.size}")

            val routeData = routePoints.map { point ->
                hashMapOf(
                    "latitude" to point.latitude,
                    "longitude" to point.longitude,
                    "timestamp" to point.timestamp,
                    "accuracy" to point.accuracy,
                    // Skip the segment ending at a resume/gap point on the server too.
                    "gap" to point.isGap
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

            // If the courier still has another active (paused) delivery, make it
            // the current one; otherwise clear the active-delivery prefs.
            switchToRemainingActiveOrClear(deliveryId)

            android.util.Log.d("DeliveryRepo", "=== COMPLETE DELIVERY SUCCESS ===")
            Resource.Success(delivery)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "=== COMPLETE DELIVERY ERROR ===")
            android.util.Log.e("DeliveryRepo", "Error: ${e.message}", e)

            // If the failure was caused by connectivity dropping mid-call, don't
            // block the courier: queue the completion and finalize it later.
            if (!isNetworkAvailable()) {
                android.util.Log.w("DeliveryRepo", "Network lost during completion — queueing offline")
                return enqueueOfflineCompletion(deliveryId, waitingMinutes)
            }

            // Check if this is a Firebase Functions error with a specific message
            val errorMessage = e.localizedMessage ?: e.message ?: "Неизвестная ошибка"
            
            Resource.Error("Ошибка завершения доставки: $errorMessage")
        }
    }

    /**
     * Persists an offline completion: marks the local delivery COMPLETED with a
     * locally-estimated distance/cost, records it in the [pendingCompletionDao]
     * queue, promotes any remaining paused delivery, and schedules the sync
     * worker. The authoritative cost is written back when the worker finalizes
     * the delivery on the server.
     */
    private suspend fun enqueueOfflineCompletion(
        deliveryId: String,
        waitingMinutes: Double
    ): Resource<Delivery> {
        val entity = deliveryDao.getById(deliveryId)
            ?: return Resource.Error("Доставка не найдена локально")

        val endTime = System.currentTimeMillis()

        // Estimate distance/cost locally the same way the active screen does, so
        // the completion screen shows a sensible value until the server syncs.
        val points = routePointDao.getPointsByDeliveryIdSync(deliveryId).map { it.toGeoPoint() }
        val isMarketplace = entity.orderKind == "MARKETPLACE"
        val onTheWayAt = entity.onTheWayStartedAt
            ?: prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
        val distancePoints = if (isMarketplace && onTheWayAt > 0) {
            points.filter { it.timestamp >= onTheWayAt }
        } else {
            points
        }
        val estimatedDistance = LocationUtils.calculateTotalDistance(distancePoints)
        val estimatedCost = try {
            tariffRepository.calculateCost(estimatedDistance, entity.deliveryType)
        } catch (e: Exception) {
            entity.cost
        }

        pendingCompletionDao.insert(
            PendingCompletionEntity(
                deliveryId = deliveryId,
                courierId = userId,
                waitingMinutes = waitingMinutes,
                endTime = endTime
            )
        )

        val completedEntity = entity.copy(
            status = DeliveryStatus.COMPLETED.name,
            endTime = endTime,
            waitingMinutes = waitingMinutes,
            distanceMeters = estimatedDistance,
            cost = estimatedCost,
            isPaused = false,
            isSynced = false
        )
        deliveryDao.update(completedEntity)

        switchToRemainingActiveOrClear(deliveryId)
        CompletionSyncWorker.schedule(context)

        android.util.Log.d("DeliveryRepo", "Offline completion queued for $deliveryId (est cost=$estimatedCost)")
        return Resource.Success(completedEntity.toDelivery())
    }

    override suspend fun syncPendingCompletions(): Resource<Unit> {
        val pending = pendingCompletionDao.getAll()
        if (pending.isEmpty()) return Resource.Success(Unit)

        android.util.Log.d("DeliveryRepo", "syncPendingCompletions: ${pending.size} queued")
        var allDone = true

        for (item in pending) {
            try {
                val doc = firestore.collection(Constants.COLLECTION_DELIVERIES)
                    .document(item.deliveryId).get().await()

                // The order vanished on the server — nothing to finalize.
                if (!doc.exists()) {
                    pendingCompletionDao.deleteById(item.deliveryId)
                    continue
                }

                when (doc.getString("status")) {
                    "COMPLETED" -> {
                        // Already completed server-side; reconcile local values.
                        val cost = doc.getDouble("cost") ?: 0.0
                        val distance = doc.getDouble("distanceMeters") ?: 0.0
                        deliveryDao.getById(item.deliveryId)?.let {
                            deliveryDao.update(
                                it.copy(
                                    status = DeliveryStatus.COMPLETED.name,
                                    cost = cost,
                                    distanceMeters = distance,
                                    endTime = doc.getLong("endTime") ?: item.endTime,
                                    isSynced = true
                                )
                            )
                        }
                        pendingCompletionDao.deleteById(item.deliveryId)
                    }

                    "IN_PROGRESS" -> {
                        val points = routePointDao.getPointsByDeliveryIdSync(item.deliveryId)
                        val localEntity = deliveryDao.getById(item.deliveryId)
                        val isMarketplace = localEntity?.orderKind == "MARKETPLACE"
                        val onTheWayAt = localEntity?.onTheWayStartedAt
                            ?: prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
                        val routePoints = if (isMarketplace && onTheWayAt > 0) {
                            points.filter { it.timestamp >= onTheWayAt }
                        } else {
                            points
                        }
                        val routeData = routePoints.map { point ->
                            hashMapOf(
                                "latitude" to point.latitude,
                                "longitude" to point.longitude,
                                "timestamp" to point.timestamp,
                                "accuracy" to point.accuracy,
                                "gap" to point.isGap
                            )
                        }
                        val data = hashMapOf(
                            "deliveryId" to item.deliveryId,
                            "courierId" to item.courierId,
                            "route" to routeData,
                            "endTime" to item.endTime,
                            "waitingMinutes" to item.waitingMinutes
                        )
                        val result = functions.getHttpsCallable("completeDelivery").call(data).await()
                        @Suppress("UNCHECKED_CAST")
                        val responseData = result.data as Map<String, Any>
                        val cost = (responseData["cost"] as? Number)?.toDouble() ?: 0.0
                        val distance = (responseData["distanceMeters"] as? Number)?.toDouble() ?: 0.0
                        deliveryDao.getById(item.deliveryId)?.let {
                            deliveryDao.update(
                                it.copy(
                                    status = DeliveryStatus.COMPLETED.name,
                                    cost = cost,
                                    distanceMeters = distance,
                                    endTime = item.endTime,
                                    isSynced = true
                                )
                            )
                        }
                        pendingCompletionDao.deleteById(item.deliveryId)
                        android.util.Log.d("DeliveryRepo", "Pending completion synced: ${item.deliveryId}")
                    }

                    else -> {
                        // CANCELLED / PENDING or other terminal state — can't be
                        // completed anymore, so drop it from the queue.
                        pendingCompletionDao.deleteById(item.deliveryId)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("DeliveryRepo", "syncPendingCompletions item failed: ${item.deliveryId}", e)
                // Keep it in the queue and retry later (likely a network hiccup).
                allDone = false
                if (!isNetworkAvailable()) break
            }
        }

        return if (allDone) Resource.Success(Unit) else Resource.Error("Есть несинхронизированные завершения")
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
            // Switch to the remaining active (paused) delivery if any, else clear.
            switchToRemainingActiveOrClear(deliveryId)

            android.util.Log.d("DeliveryRepo", "=== CANCEL DELIVERY SUCCESS ===")
            Resource.Success(Unit)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "=== CANCEL DELIVERY ERROR ===")
            android.util.Log.e("DeliveryRepo", "Error: ${e.message}", e)
            Resource.Error("Ошибка отмены доставки: ${e.localizedMessage}")
        }
    }

    override fun getActiveDelivery(): Flow<Delivery?> {
        // Return the delivery whose meter is currently running (the one stored in
        // PREF_ACTIVE_DELIVERY_ID). Fall back to the first active one if the pref
        // is missing/stale (e.g. after completing the previous current delivery).
        return deliveryDao.getActiveDeliveries(userId).map { list ->
            val currentId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""
            val current = list.firstOrNull { it.id == currentId } ?: list.firstOrNull()
            current?.toDelivery()
        }
    }

    override fun getActiveDeliveries(): Flow<List<Delivery>> {
        return deliveryDao.getActiveDeliveries(userId).map { list -> list.map { it.toDelivery() } }
    }

    override fun getCurrentActiveDeliveryId(): String {
        return prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""
    }

    override suspend fun setCurrentActiveDelivery(deliveryId: String) {
        makeCurrent(deliveryId)
    }

    override suspend fun setDeliveryPaused(deliveryId: String, paused: Boolean) {
        val entity = deliveryDao.getById(deliveryId) ?: return
        // When pausing, also freeze any running waiting timer (accumulate it).
        if (paused && entity.waitingStartedAt != null) {
            val add = (System.currentTimeMillis() - entity.waitingStartedAt).coerceAtLeast(0L)
            deliveryDao.update(
                entity.copy(
                    isPaused = true,
                    waitingAccumulatedMs = entity.waitingAccumulatedMs + add,
                    waitingStartedAt = null
                )
            )
        } else {
            deliveryDao.update(entity.copy(isPaused = paused))
        }
    }

    override suspend fun setDeliveryWaiting(deliveryId: String, waiting: Boolean) {
        val entity = deliveryDao.getById(deliveryId) ?: return
        val now = System.currentTimeMillis()
        if (waiting) {
            // Start waiting (only if not already running).
            if (entity.waitingStartedAt == null) {
                deliveryDao.update(entity.copy(waitingStartedAt = now))
            }
        } else {
            // Stop waiting: accumulate the running interval into the frozen total.
            val startedAt = entity.waitingStartedAt
            if (startedAt != null) {
                val add = (now - startedAt).coerceAtLeast(0L)
                deliveryDao.update(
                    entity.copy(
                        waitingAccumulatedMs = entity.waitingAccumulatedMs + add,
                        waitingStartedAt = null
                    )
                )
            }
        }
    }

    /**
     * Sets [deliveryId] as the current running delivery and freezes the meter of
     * the previously-current delivery by stopping (accumulating) its running
     * waiting time. Also keeps the legacy global ON_THE_WAY pref in sync with the
     * new current delivery for backward compatibility.
     */
    private suspend fun makeCurrent(deliveryId: String) {
        val previousId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""
        if (previousId.isNotEmpty() && previousId != deliveryId) {
            val previous = deliveryDao.getById(previousId)
            if (previous != null && previous.status == DeliveryStatus.IN_PROGRESS.name) {
                // Freeze waiting on the delivery being paused.
                val startedAt = previous.waitingStartedAt
                if (startedAt != null) {
                    val add = (System.currentTimeMillis() - startedAt).coerceAtLeast(0L)
                    deliveryDao.update(
                        previous.copy(
                            waitingAccumulatedMs = previous.waitingAccumulatedMs + add,
                            waitingStartedAt = null
                        )
                    )
                    // For marketplace orders, tell the server to stop the waiting timer too.
                    if (previous.orderKind == "MARKETPLACE") {
                        runCatching { updateMarketplaceDeliveryStage(previousId, null, "STOP") }
                    }
                }
            }
        }

        val current = deliveryDao.getById(deliveryId)
        // A delivery that becomes current runs — clear any explicit pause flag.
        if (current != null && current.isPaused) {
            deliveryDao.update(current.copy(isPaused = false))
        }
        val editor = prefs.edit().putString(Constants.PREF_ACTIVE_DELIVERY_ID, deliveryId)
        // Keep the legacy global pref aligned with the new current delivery so
        // marketplace distance filtering stays correct when switching.
        val onTheWay = current?.onTheWayStartedAt
        if (onTheWay != null && onTheWay > 0) {
            editor.putLong(Constants.PREF_ON_THE_WAY_STARTED_AT, onTheWay)
        } else {
            editor.remove(Constants.PREF_ON_THE_WAY_STARTED_AT)
        }
        editor.apply()
    }

    /**
     * After a delivery is completed/cancelled, promote any remaining IN_PROGRESS
     * delivery to be the current (running) one, or clear the active prefs when the
     * courier has no more active deliveries.
     */
    private suspend fun switchToRemainingActiveOrClear(finishedDeliveryId: String) {
        val remaining = deliveryDao.getActiveDeliveriesSync(userId)
            .firstOrNull { it.id != finishedDeliveryId }
        if (remaining != null) {
            makeCurrent(remaining.id)
        } else {
            prefs.edit()
                .remove(Constants.PREF_ACTIVE_DELIVERY_ID)
                .remove(Constants.PREF_ON_THE_WAY_STARTED_AT)
                .apply()
        }
    }

    override suspend fun syncRemoteActiveDelivery(): Resource<Delivery?> {
        return try {
            // Fetch up to the concurrency limit of active deliveries and mirror
            // them locally so both a current and a paused order survive an app
            // restart / re-login.
            val snapshot = firestore.collection(Constants.COLLECTION_DELIVERIES)
                .whereEqualTo("courierId", userId)
                .whereEqualTo("status", "IN_PROGRESS")
                .limit(Constants.MAX_CONCURRENT_DELIVERIES.toLong())
                .get()
                .await()

            val remote = snapshot.documents.mapNotNull { runCatching { it.toDeliveryModel() }.getOrNull() }
            if (remote.isEmpty()) {
                return Resource.Success(null)
            }

            remote.forEach { delivery ->
                // Preserve locally-tracked pause/meter fields that don't live on
                // the server document.
                val local = deliveryDao.getById(delivery.id)
                val merged = DeliveryEntity.fromDelivery(delivery).copy(
                    isSynced = true,
                    waitingAccumulatedMs = local?.waitingAccumulatedMs ?: 0L,
                    onTheWayStartedAt = local?.onTheWayStartedAt ?: delivery.onTheWayStartedAt
                )
                deliveryDao.insert(merged)
            }
            prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()

            // Only set the current delivery if none is validly set yet, so we don't
            // override the courier's current selection when two orders are active.
            val currentId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""
            val currentStillActive = remote.any { it.id == currentId }
            if (!currentStillActive) {
                makeCurrent(remote.first().id)
            }

            val current = remote.firstOrNull { it.id == getCurrentActiveDeliveryId() } ?: remote.first()
            Resource.Success(current)
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
                .remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID)
                .apply()
            // Make the newly accepted order the current one; this pauses (freezes)
            // the previously-current delivery if the courier already had one.
            makeCurrent(delivery.id)

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

            val now = System.currentTimeMillis()
            val current = deliveryDao.getById(deliveryId)
            current?.let {
                // Maintain persisted waiting so it survives pausing/switching.
                var accumulated = it.waitingAccumulatedMs
                var waitingStartedAt = it.waitingStartedAt
                when (waitingAction) {
                    "START" -> if (waitingStartedAt == null) waitingStartedAt = now
                    "STOP" -> if (waitingStartedAt != null) {
                        accumulated += (now - waitingStartedAt).coerceAtLeast(0L)
                        waitingStartedAt = null
                    }
                }
                val onTheWayStartedAt = if (stage == "ON_THE_WAY" && it.onTheWayStartedAt == null) {
                    now
                } else {
                    it.onTheWayStartedAt
                }
                deliveryDao.update(it.copy(
                    adminOrderStage = stage ?: it.adminOrderStage,
                    waitingStartedAt = waitingStartedAt,
                    waitingAccumulatedMs = accumulated,
                    onTheWayStartedAt = onTheWayStartedAt
                ))
            }
            if (stage == "ON_THE_WAY") {
                // Keep the legacy global pref for backward compatibility (used as a
                // fallback for deliveries that reached ON_THE_WAY before this update).
                prefs.edit()
                    .putLong(Constants.PREF_ON_THE_WAY_STARTED_AT, now)
                    .apply()
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

    override suspend fun syncHistoryFromFirestore(courierId: String): Resource<Unit> {
        return try {
            val docs = firestore.collection(Constants.COLLECTION_DELIVERIES)
                .whereEqualTo("courierId", courierId)
                .orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(200)
                .get()
                .await()

            docs.documents.forEach { doc ->
                try {
                    val delivery = doc.toDeliveryModel()
                    deliveryDao.insert(DeliveryEntity.fromDelivery(delivery).copy(isSynced = true))
                } catch (e: Exception) {
                    android.util.Log.w("DeliveryRepo", "Skipping malformed delivery doc ${doc.id}", e)
                }
            }

            android.util.Log.d("DeliveryRepo", "Synced ${docs.size()} deliveries from Firestore for courier $courierId")
            Resource.Success(Unit)
        } catch (e: Exception) {
            android.util.Log.e("DeliveryRepo", "Error syncing history from Firestore", e)
            Resource.Error("Ошибка загрузки истории: ${e.localizedMessage}")
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
