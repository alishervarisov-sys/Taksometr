package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryOrderItem
import com.zaki.taksometr.domain.model.DeliveryStatus
import org.json.JSONArray
import org.json.JSONObject

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
    val restaurantName: String = "",
    val orderItemsJson: String = "[]",
    val productsPrice: Double = 0.0,
    val totalPrice: Double = 0.0,
    val pickupAddress: String = "",
    val pickupLat: Double? = null,
    val pickupLng: Double? = null,
    val destinationAddress: String = "",
    val destinationLat: Double? = null,
    val destinationLng: Double? = null,
    val waitingMinutes: Double = 0.0,
    val waitingStartedAt: Long? = null,
    val courierPhone: String = "",
    val isSynced: Boolean = false,
    val waitingAccumulatedMs: Long = 0L,
    val onTheWayStartedAt: Long? = null,
    val isPaused: Boolean = false,
    val acceptanceLimitMinutes: Int = 10,
    val acceptanceDurationMs: Long? = null
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
        restaurantName = restaurantName,
        orderItems = parseOrderItems(orderItemsJson),
        productsPrice = productsPrice,
        totalPrice = totalPrice,
        pickupAddress = pickupAddress,
        pickupLat = pickupLat,
        pickupLng = pickupLng,
        destinationAddress = destinationAddress,
        destinationLat = destinationLat,
        destinationLng = destinationLng,
        waitingMinutes = waitingMinutes,
        waitingStartedAt = waitingStartedAt,
        courierPhone = courierPhone,
        waitingAccumulatedMs = waitingAccumulatedMs,
        onTheWayStartedAt = onTheWayStartedAt,
        isPaused = isPaused,
        acceptanceLimitMinutes = acceptanceLimitMinutes,
        acceptanceDurationMs = acceptanceDurationMs
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
            restaurantName = delivery.restaurantName,
            orderItemsJson = orderItemsToJson(delivery.orderItems),
            productsPrice = delivery.productsPrice,
            totalPrice = delivery.totalPrice,
            pickupAddress = delivery.pickupAddress,
            pickupLat = delivery.pickupLat,
            pickupLng = delivery.pickupLng,
            destinationAddress = delivery.destinationAddress,
            destinationLat = delivery.destinationLat,
            destinationLng = delivery.destinationLng,
            waitingMinutes = delivery.waitingMinutes,
            waitingStartedAt = delivery.waitingStartedAt,
            courierPhone = delivery.courierPhone,
            waitingAccumulatedMs = delivery.waitingAccumulatedMs,
            onTheWayStartedAt = delivery.onTheWayStartedAt,
            isPaused = delivery.isPaused,
            acceptanceLimitMinutes = delivery.acceptanceLimitMinutes,
            acceptanceDurationMs = delivery.acceptanceDurationMs
        )
    }
}

private fun orderItemsToJson(items: List<DeliveryOrderItem>): String =
    JSONArray().apply {
        items.forEach { item ->
            put(JSONObject().apply {
                put("name", item.name)
                put("quantity", item.quantity)
                put("price", item.price)
                put("imageUrl", item.imageUrl)
            })
        }
    }.toString()

private fun parseOrderItems(json: String): List<DeliveryOrderItem> = runCatching {
    val array = JSONArray(json)
    List(array.length()) { index ->
        val item = array.getJSONObject(index)
        DeliveryOrderItem(
            name = item.optString("name"),
            quantity = item.optDouble("quantity", 1.0),
            price = item.optDouble("price", 0.0),
            imageUrl = item.optString("imageUrl")
        )
    }
}.getOrDefault(emptyList())
