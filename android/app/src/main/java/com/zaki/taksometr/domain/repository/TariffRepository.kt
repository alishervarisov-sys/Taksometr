package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.Tariff
import kotlinx.coroutines.flow.Flow

interface TariffRepository {
    fun getCurrentTariff(): Flow<Tariff>
    suspend fun calculateCost(distanceMeters: Double): Double
}
