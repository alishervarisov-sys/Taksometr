package com.zaki.taksometr.domain.model

data class DeliveryChain(
    val id: String,
    val courierId: String,
    val courierName: String,
    val status: DeliveryChainStatus,
    val items: List<ChainDeliveryItem> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
    val startedAt: Long? = null,
    val completedAt: Long? = null,
    val totalDistance: Double = 0.0,
    val totalCost: Double = 0.0
)

enum class DeliveryChainStatus {
    DRAFT,       // Создается, можно редактировать
    IN_PROGRESS, // Запущена, выполняется
    COMPLETED,   // Все доставки завершены
    CANCELLED    // Отменена
}

data class ChainDeliveryItem(
    val id: String,
    val chainId: String,
    val clientPhone: String,
    val orderNumber: String,
    val sequenceOrder: Int,
    val status: DeliveryStatus,
    val deliveryId: String? = null,
    val startTime: Long? = null,
    val endTime: Long? = null,
    val distanceMeters: Double = 0.0,
    val cost: Double = 0.0,
    val deliveryType: String = "default",
    val fixedPrice: Double? = null,
    val createdAt: Long = System.currentTimeMillis()
)
