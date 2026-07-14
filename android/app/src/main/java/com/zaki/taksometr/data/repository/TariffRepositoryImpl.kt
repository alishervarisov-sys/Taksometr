package com.zaki.taksometr.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import com.zaki.taksometr.domain.model.Tariff
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.util.Constants
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TariffRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val functions: FirebaseFunctions
) : TariffRepository {

    override fun getCurrentTariff(): Flow<Tariff> = callbackFlow {
        val listener = firestore.collection(Constants.COLLECTION_TARIFFS)
            .document("default")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null || !snapshot.exists()) {
                    trySend(Tariff()) // Default tariff
                    return@addSnapshotListener
                }

                val tariff = Tariff(
                    id = snapshot.id,
                    baseCost = snapshot.getDouble("baseCost") ?: 5000.0,
                    baseDistanceKm = snapshot.getDouble("baseDistanceKm") ?: 3.0,
                    costPerKm = snapshot.getDouble("costPerKm") ?: 1500.0,
                    currency = snapshot.getString("currency") ?: "сум",
                    isActive = snapshot.getBoolean("isActive") ?: true,
                    updatedAt = snapshot.getLong("updatedAt") ?: 0L
                )
                trySend(tariff)
            }

        awaitClose { listener.remove() }
    }

    override suspend fun calculateCost(distanceMeters: Double, deliveryType: String): Double {
        // Local calculation with distance threshold for real-time display.
        // Final cost is always re-computed on the server in completeDelivery.
        return try {
            val tariffDoc = firestore.collection(Constants.COLLECTION_TARIFFS)
                .document("default")
                .get()
                .await()

            val baseCost: Double
            val baseDistanceKm: Double
            val costPerKm: Double

            if (deliveryType == "heavyCargoMeter") {
                @Suppress("UNCHECKED_CAST")
                val hcm = tariffDoc.get("heavyCargoMeter") as? Map<String, Any> ?: emptyMap()
                baseCost = (hcm["baseCost"] as? Number)?.toDouble() ?: 15.0
                baseDistanceKm = (hcm["baseDistanceKm"] as? Number)?.toDouble() ?: 3.0
                costPerKm = (hcm["costPerKm"] as? Number)?.toDouble() ?: 4.0
            } else {
                baseCost = tariffDoc.getDouble("baseCost") ?: 5000.0
                baseDistanceKm = tariffDoc.getDouble("baseDistanceKm") ?: 3.0
                costPerKm = tariffDoc.getDouble("costPerKm") ?: 1500.0
            }

            val distanceKm = distanceMeters / 1000.0

            // Round to 2 decimal places for exact diram display
            val rawCost = if (distanceKm > baseDistanceKm) {
                baseCost + (distanceKm - baseDistanceKm) * costPerKm
            } else {
                baseCost
            }
            kotlin.math.max(baseCost, kotlin.math.round(rawCost * 100.0) / 100.0)
        } catch (e: Exception) {
            0.0
        }
    }
}
