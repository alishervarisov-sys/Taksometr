package com.zaki.taksometr.domain.model

data class Delivery(
    val id: String = "",
    val courierId: String = "",
    val courierName: String = "",
    val clientPhone: String = "",
    val status: DeliveryStatus = DeliveryStatus.IN_PROGRESS,
    val startTime: Long = System.currentTimeMillis(),
    val endTime: Long? = null,
    val distanceMeters: Double = 0.0,
    val cost: Double = 0.0,
    val route: List<GeoPoint> = emptyList(),
    val createdAt: Long = System.currentTimeMillis()
)

enum class DeliveryStatus {
    IN_PROGRESS,
    COMPLETED,
    CANCELLED
}

data class GeoPoint(
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val timestamp: Long = System.currentTimeMillis(),
    val accuracy: Float = 0f
)
