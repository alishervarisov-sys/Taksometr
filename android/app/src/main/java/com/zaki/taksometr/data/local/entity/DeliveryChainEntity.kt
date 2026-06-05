package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.zaki.taksometr.domain.model.DeliveryChain
import com.zaki.taksometr.domain.model.DeliveryChainStatus

@Entity(tableName = "delivery_chains")
data class DeliveryChainEntity(
    @PrimaryKey
    val id: String,
    val courierId: String,
    val courierName: String,
    val status: String, // DRAFT, IN_PROGRESS, COMPLETED, CANCELLED
    val createdAt: Long,
    val startedAt: Long?,
    val completedAt: Long?,
    val totalDistance: Double = 0.0,
    val totalCost: Double = 0.0,
    val isSynced: Boolean = false
) {
    fun toDeliveryChain(): DeliveryChain = DeliveryChain(
        id = id,
        courierId = courierId,
        courierName = courierName,
        status = DeliveryChainStatus.valueOf(status),
        createdAt = createdAt,
        startedAt = startedAt,
        completedAt = completedAt,
        totalDistance = totalDistance,
        totalCost = totalCost,
        items = emptyList() // Will be loaded separately
    )

    companion object {
        fun fromDeliveryChain(chain: DeliveryChain): DeliveryChainEntity = DeliveryChainEntity(
            id = chain.id,
            courierId = chain.courierId,
            courierName = chain.courierName,
            status = chain.status.name,
            createdAt = chain.createdAt,
            startedAt = chain.startedAt,
            completedAt = chain.completedAt,
            totalDistance = chain.totalDistance,
            totalCost = chain.totalCost,
            isSynced = false
        )
    }
}
