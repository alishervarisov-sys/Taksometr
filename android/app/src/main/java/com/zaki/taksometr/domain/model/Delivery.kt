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
    val deliveryType: String = "default",
    val fixedPrice: Double? = null,
    val createdAt: Long = System.currentTimeMillis(),
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
    val courierPhone: String = ""
)

enum class DeliveryStatus {
    PENDING,
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
