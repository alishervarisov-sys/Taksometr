package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.Tariff
import kotlinx.coroutines.flow.Flow

interface TariffRepository {
    fun getCurrentTariff(): Flow<Tariff>
    suspend fun calculateCost(distanceMeters: Double, deliveryType: String = "default"): Double
    /**
     * Fixed-price delivery types (name -> price) from the local tariff cache.
     * Works fully offline; the cache is refreshed from Firestore in background.
     */
    suspend fun getFixedDeliveryTypes(): Map<String, Double>
}
