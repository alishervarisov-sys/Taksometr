package com.zaki.taksometr.domain.model

data class Tariff(
    val id: String = "default",
    val baseCost: Double = 5000.0,
    val baseDistanceKm: Double = 3.0,
    val costPerKm: Double = 1500.0,
    val currency: String = "сум",
    val isActive: Boolean = true,
    val updatedAt: Long = System.currentTimeMillis()
)
