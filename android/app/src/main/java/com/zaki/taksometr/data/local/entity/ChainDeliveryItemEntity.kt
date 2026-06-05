package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.zaki.taksometr.domain.model.ChainDeliveryItem
import com.zaki.taksometr.domain.model.DeliveryStatus

@Entity(
    tableName = "chain_delivery_items",
    foreignKeys = [
        ForeignKey(
            entity = DeliveryChainEntity::class,
            parentColumns = ["id"],
            childColumns = ["chainId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("chainId")]
)
data class ChainDeliveryItemEntity(
    @PrimaryKey
    val id: String,
    val chainId: String,
    val clientPhone: String,
    val orderNumber: String, // Номер заказа клиента
    val sequenceOrder: Int, // Очередность доставки (1, 2, 3...)
    val status: String, // PENDING, IN_PROGRESS, COMPLETED, CANCELLED
    val deliveryId: String?, // ID созданной доставки (после запуска)
    val startTime: Long?,
    val endTime: Long?,
    val distanceMeters: Double = 0.0,
    val cost: Double = 0.0,
    val deliveryType: String = "default",
    val fixedPrice: Double? = null,
    val createdAt: Long
) {
    fun toChainDeliveryItem(): ChainDeliveryItem = ChainDeliveryItem(
        id = id,
        chainId = chainId,
        clientPhone = clientPhone,
        orderNumber = orderNumber,
        sequenceOrder = sequenceOrder,
        status = DeliveryStatus.valueOf(status),
        deliveryId = deliveryId,
        startTime = startTime,
        endTime = endTime,
        distanceMeters = distanceMeters,
        cost = cost,
        deliveryType = deliveryType,
        fixedPrice = fixedPrice,
        createdAt = createdAt
    )

    companion object {
        fun fromChainDeliveryItem(item: ChainDeliveryItem): ChainDeliveryItemEntity =
            ChainDeliveryItemEntity(
                id = item.id,
                chainId = item.chainId,
                clientPhone = item.clientPhone,
                orderNumber = item.orderNumber,
                sequenceOrder = item.sequenceOrder,
                status = item.status.name,
                deliveryId = item.deliveryId,
                startTime = item.startTime,
                endTime = item.endTime,
                distanceMeters = item.distanceMeters,
                cost = item.cost,
                deliveryType = item.deliveryType,
                fixedPrice = item.fixedPrice,
                createdAt = item.createdAt
            )
    }
}
