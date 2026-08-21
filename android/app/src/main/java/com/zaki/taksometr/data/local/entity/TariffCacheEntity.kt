package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Last-known snapshot of the `tariffs/default` Firestore document, persisted so
 * the taxometer can calculate the live cost fully offline right after an app
 * restart. Refreshed from Firestore whenever the network is available.
 */
@Entity(tableName = "tariff_cache")
data class TariffCacheEntity(
    @PrimaryKey
    val id: String = "default",
    val baseCost: Double,
    val baseDistanceKm: Double,
    val costPerKm: Double,
    val fixedTypesJson: String,
    val heavyCargoJson: String,
    val currency: String,
    val updatedAt: Long
)
