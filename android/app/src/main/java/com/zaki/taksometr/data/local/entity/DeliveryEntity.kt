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
    val deliveryType: String = "default",
    val fixedPrice: Double? = null,
    val createdAt: Long,
    val orderKind: String = "REGULAR",
    val adminOrderStage: String? = null,
    val comment: String = "",
    val pickupAddress: String = "",
    val pickupLat: Double? = null,
    val pickupLng: Double? = null,
    val destinationAddress: String = "",
    val destinationLat: Double? = null,
    val destinationLng: Double? = null,
    val waitingMinutes: Double = 0.0,
    val waitingStartedAt: Long? = null,
    val courierPhone: String = "",
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
        deliveryType = deliveryType,
        fixedPrice = fixedPrice,
        createdAt = createdAt,
        orderKind = orderKind,
        adminOrderStage = adminOrderStage,
        comment = comment,
        pickupAddress = pickupAddress,
        pickupLat = pickupLat,
        pickupLng = pickupLng,
        destinationAddress = destinationAddress,
        destinationLat = destinationLat,
        destinationLng = destinationLng,
        waitingMinutes = waitingMinutes,
        waitingStartedAt = waitingStartedAt,
        courierPhone = courierPhone
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
            deliveryType = delivery.deliveryType,
            fixedPrice = delivery.fixedPrice,
            createdAt = delivery.createdAt,
            orderKind = delivery.orderKind,
            adminOrderStage = delivery.adminOrderStage,
            comment = delivery.comment,
            pickupAddress = delivery.pickupAddress,
            pickupLat = delivery.pickupLat,
            pickupLng = delivery.pickupLng,
            destinationAddress = delivery.destinationAddress,
            destinationLat = delivery.destinationLat,
            destinationLng = delivery.destinationLng,
            waitingMinutes = delivery.waitingMinutes,
            waitingStartedAt = delivery.waitingStartedAt,
            courierPhone = delivery.courierPhone
        )
    }
}
