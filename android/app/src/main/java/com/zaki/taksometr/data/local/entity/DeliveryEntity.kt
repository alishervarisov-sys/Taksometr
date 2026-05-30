package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus

@Entity(tableName = "deliveries")
data class DeliveryEntity(
    @PrimaryKey
    val id: String,
    val courierId: String,
    val courierName: String,
    val clientPhone: String,
    val status: String,
    val startTime: Long,
    val endTime: Long?,
    val distanceMeters: Double,
    val cost: Double,
    val createdAt: Long,
    val isSynced: Boolean = false
) {
    fun toDelivery(): Delivery = Delivery(
        id = id,
        courierId = courierId,
        courierName = courierName,
        clientPhone = clientPhone,
        status = DeliveryStatus.valueOf(status),
        startTime = startTime,
        endTime = endTime,
        distanceMeters = distanceMeters,
        cost = cost,
        createdAt = createdAt
    )

    companion object {
        fun fromDelivery(delivery: Delivery): DeliveryEntity = DeliveryEntity(
            id = delivery.id,
            courierId = delivery.courierId,
            courierName = delivery.courierName,
            clientPhone = delivery.clientPhone,
            status = delivery.status.name,
            startTime = delivery.startTime,
            endTime = delivery.endTime,
            distanceMeters = delivery.distanceMeters,
            cost = delivery.cost,
            createdAt = delivery.createdAt
        )
    }
}
