package com.zaki.taksometr.data.repository

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import com.zaki.taksometr.data.local.dao.TariffCacheDao
import com.zaki.taksometr.data.local.entity.TariffCacheEntity
import com.zaki.taksometr.domain.model.Tariff
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.util.Constants
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Offline-first tariff repository. The tariff snapshot is kept in memory and
 * persisted in the Room `tariff_cache` table, so [calculateCost] and
 * [getFixedDeliveryTypes] never perform a network call and always return a
 * sensible value — even right after an app restart with no internet. The cache
 * is refreshed from Firestore in the background (rate-limited) whenever the
 * network is available.
 */
@Singleton
class TariffRepositoryImpl @Inject constructor(
    private val context: Context,
    private val firestore: FirebaseFirestore,
    private val functions: FirebaseFunctions,
    private val tariffCacheDao: TariffCacheDao
) : TariffRepository {

    private data class CachedTariff(
        val baseCost: Double = 5000.0,
        val baseDistanceKm: Double = 3.0,
        val costPerKm: Double = 1500.0,
        val fixedTypes: Map<String, Double> = emptyMap(),
        val heavyCargo: Map<String, Double> = mapOf(
            "baseCost" to 15.0, "baseDistanceKm" to 3.0, "costPerKm" to 4.0
        ),
        val currency: String = "сум"
    )

    private val cacheScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cacheMutex = Mutex()

    @Volatile
    private var cached: CachedTariff = CachedTariff()

    @Volatile
    private var loadedFromDb = false

    @Volatile
    private var lastRefreshAt = 0L

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
                // Keep the offline cache warm while a listener is attached.
                cacheScope.launch {
                    runCatching { applyRemoteTariff(snapshot.data) }
                }
                trySend(tariff)
            }

        awaitClose { listener.remove() }
    }

    /**
     * Loads the persisted snapshot once, then (in the background) refreshes it
     * from Firestore. Safe to call on every [calculateCost] invocation — the
     * actual work happens at most once / refresh interval.
     */
    private suspend fun ensureCacheLoaded() {
        if (!loadedFromDb) {
            cacheMutex.withLock {
                if (loadedFromDb) return
                tariffCacheDao.get()?.let { entity ->
                    cached = CachedTariff(
                        baseCost = entity.baseCost,
                        baseDistanceKm = entity.baseDistanceKm,
                        costPerKm = entity.costPerKm,
                        fixedTypes = parseDoubleMap(entity.fixedTypesJson),
                        heavyCargo = parseDoubleMap(entity.heavyCargoJson),
                        currency = entity.currency
                    )
                }
                loadedFromDb = true
            }
        }
        maybeRefreshFromFirestore()
    }

    private fun maybeRefreshFromFirestore() {
        val now = System.currentTimeMillis()
        if (now - lastRefreshAt < REFRESH_INTERVAL_MS) return
        if (!isNetworkAvailable()) return
        lastRefreshAt = now
        cacheScope.launch {
            try {
                val doc = firestore.collection(Constants.COLLECTION_TARIFFS)
                    .document("default")
                    .get()
                    .await()
                if (doc.exists()) applyRemoteTariff(doc.data)
            } catch (_: Exception) {
                // Offline / transient error — keep the cached snapshot.
                lastRefreshAt = 0L
            }
        }
    }

    private suspend fun applyRemoteTariff(data: Map<String, Any>?) {
        if (data == null) return
        @Suppress("UNCHECKED_CAST")
        val fixedTypes = (data["fixedTypes"] as? Map<String, Any>)
            ?.mapValues { (_, v) -> (v as? Number)?.toDouble() ?: 0.0 }
            ?: emptyMap()
        @Suppress("UNCHECKED_CAST")
        val hcm = (data["heavyCargoMeter"] as? Map<String, Any>)
            ?.mapValues { (_, v) -> (v as? Number)?.toDouble() ?: 0.0 }
            ?: emptyMap()

        val newCache = CachedTariff(
            baseCost = (data["baseCost"] as? Number)?.toDouble() ?: 5000.0,
            baseDistanceKm = (data["baseDistanceKm"] as? Number)?.toDouble() ?: 3.0,
            costPerKm = (data["costPerKm"] as? Number)?.toDouble() ?: 1500.0,
            fixedTypes = fixedTypes,
            heavyCargo = if (hcm.isEmpty()) cached.heavyCargo else hcm,
            currency = data["currency"] as? String ?: "сум"
        )

        cacheMutex.withLock { cached = newCache }
        loadedFromDb = true

        tariffCacheDao.insert(
            TariffCacheEntity(
                baseCost = newCache.baseCost,
                baseDistanceKm = newCache.baseDistanceKm,
                costPerKm = newCache.costPerKm,
                fixedTypesJson = JSONObject(newCache.fixedTypes).toString(),
                heavyCargoJson = JSONObject(newCache.heavyCargo).toString(),
                currency = newCache.currency,
                updatedAt = System.currentTimeMillis()
            )
        )
    }

    private fun parseDoubleMap(json: String): Map<String, Double> = try {
        val obj = JSONObject(json)
        obj.keys().asSequence().associateWith { key ->
            obj.optDouble(key, 0.0)
        }
    } catch (_: Exception) {
        emptyMap()
    }

    /**
     * Pure local calculation from the cached tariff. Never touches the network,
     * never blocks, and never returns 0 because of a missing connection.
     */
    override suspend fun calculateCost(distanceMeters: Double, deliveryType: String): Double {
        ensureCacheLoaded()
        val c = cached

        val baseCost: Double
        val baseDistanceKm: Double
        val costPerKm: Double

        if (deliveryType == "heavyCargoMeter") {
            baseCost = c.heavyCargo["baseCost"] ?: 15.0
            baseDistanceKm = c.heavyCargo["baseDistanceKm"] ?: 3.0
            costPerKm = c.heavyCargo["costPerKm"] ?: 4.0
        } else {
            baseCost = c.baseCost
            baseDistanceKm = c.baseDistanceKm
            costPerKm = c.costPerKm
        }

        val distanceKm = distanceMeters / 1000.0
        val rawCost = if (distanceKm > baseDistanceKm) {
            baseCost + (distanceKm - baseDistanceKm) * costPerKm
        } else {
            baseCost
        }
        return kotlin.math.max(baseCost, kotlin.math.round(rawCost * 100.0) / 100.0)
    }

    /** Fixed delivery types from the local cache (no network, instant). */
    override suspend fun getFixedDeliveryTypes(): Map<String, Double> {
        ensureCacheLoaded()
        return cached.fixedTypes
    }

    private fun isNetworkAvailable(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val REFRESH_INTERVAL_MS = 5 * 60 * 1000L // 5 minutes
    }
}
