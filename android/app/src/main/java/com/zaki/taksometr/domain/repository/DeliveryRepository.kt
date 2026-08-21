package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.flow.Flow

interface DeliveryRepository {
    suspend fun createDelivery(clientPhone: String, deliveryType: String = "default"): Resource<Delivery>
    suspend fun completeDelivery(deliveryId: String, waitingMinutes: Double = 0.0): Resource<Delivery>
    suspend fun cancelDelivery(deliveryId: String): Resource<Unit>
    suspend fun getFixedDeliveryTypes(): Resource<Map<String, Double>>
    fun getActiveDelivery(): Flow<Delivery?>
    /** All of the courier's IN_PROGRESS deliveries (up to the concurrency limit). */
    fun getActiveDeliveries(): Flow<List<Delivery>>
    /** Id of the delivery whose meter is currently running (others are paused). */
    fun getCurrentActiveDeliveryId(): String
    /**
     * Makes [deliveryId] the current (running) delivery and freezes the meter of
     * the previously-current one (accumulates its running waiting time).
     */
    suspend fun setCurrentActiveDelivery(deliveryId: String)
    /** Persists waiting start/stop for a specific delivery (accumulates on stop). */
    suspend fun setDeliveryWaiting(deliveryId: String, waiting: Boolean)
    /** Explicitly pauses/resumes a delivery's meter (freezes distance & waiting). */
    suspend fun setDeliveryPaused(deliveryId: String, paused: Boolean)
    fun getDeliveryHistory(courierId: String): Flow<List<Delivery>>
    fun searchDeliveries(phone: String): Flow<List<Delivery>>
    fun getDeliveriesByDateRange(startDate: Long, endDate: Long): Flow<List<Delivery>>
    suspend fun getDeliveryById(deliveryId: String): Resource<Delivery>
    suspend fun updateRoute(deliveryId: String, points: List<GeoPoint>)
    suspend fun updateDistance(deliveryId: String, distanceMeters: Double)
    fun getTodayStats(courierId: String): Flow<TodayStats>
    suspend fun syncDeliveryStatusFromFirestore(deliveryId: String): Resource<Delivery?>
    suspend fun clearStaleActiveDelivery()
    suspend fun syncRemoteActiveDelivery(): Resource<Delivery?>
    suspend fun acceptMarketplaceDelivery(deliveryId: String): Resource<Delivery>
    suspend fun updateMarketplaceDeliveryStage(deliveryId: String, stage: String? = null, waitingAction: String? = null): Resource<Unit>
    suspend fun syncHistoryFromFirestore(courierId: String): Resource<Unit>
    /**
     * Finalizes on the server all deliveries the courier completed while offline
     * (see the `pending_completions` queue). Returns Success when the queue is
     * empty afterwards, Error when some items still need another attempt.
     */
    suspend fun syncPendingCompletions(): Resource<Unit>
    /**
     * Replays the generic offline operation queue (`pending_operations`):
     * offline-created deliveries, cancellations, marketplace stage changes and
     * the buffered courier location. Also flushes the offline completion queue.
     * Returns Success when everything was synced, Error when some operations
     * need another attempt.
     */
    suspend fun syncPendingOperations(): Resource<Unit>
}

data class TodayStats(
    val deliveryCount: Int = 0,
    val totalEarnings: Double = 0.0
)
