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
}

data class TodayStats(
    val deliveryCount: Int = 0,
    val totalEarnings: Double = 0.0
)
