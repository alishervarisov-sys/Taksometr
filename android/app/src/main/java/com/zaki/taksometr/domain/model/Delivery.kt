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
    val restaurantName: String = "",
    val orderItems: List<DeliveryOrderItem> = emptyList(),
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
    val currentSpeedKmh: Float? = null,
    val maxSpeedKmh: Float? = null,
    // Accumulated (frozen) waiting time in milliseconds, persisted so waiting
    // survives pausing/switching between concurrent deliveries.
    val waitingAccumulatedMs: Long = 0L,
    // For MARKETPLACE orders: per-delivery timestamp when the courier started
    // driving to the client (ON_THE_WAY). Replaces the single global pref so
    // two concurrent marketplace orders don't clobber each other.
    val onTheWayStartedAt: Long? = null,
    // True when the courier has explicitly paused this order's meter (distance
    // and waiting are frozen) while keeping it IN_PROGRESS.
    val isPaused: Boolean = false,
    // Dispatcher response SLA for a marketplace order. The elapsed value is
    // written by the server when a courier accepts the order, so it remains a
    // trustworthy part of both parties' history.
    val acceptanceLimitMinutes: Int = 10,
    val acceptanceDurationMs: Long? = null,
    val requiresRecipientCode: Boolean = false,
    val requiresDeliveryPhoto: Boolean = false,
    val recipientCodeVerified: Boolean = false,
    val deliveryPhotoSubmitted: Boolean = false,
    val deliveryConfirmedAt: Long? = null
)

/** A purchased dish as supplied by Motorol for a marketplace food order. */
data class DeliveryOrderItem(
    val name: String = "",
    val quantity: Double = 1.0,
    val price: Double = 0.0,
    val imageUrl: String = ""
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
    val accuracy: Float = 0f,
    // Marks a discontinuity in the route (e.g. the first point recorded after
    // resuming a paused delivery). Distance calculations skip the segment that
    // ends at a gap point so travel done for another order isn't counted here.
    val isGap: Boolean = false
)
