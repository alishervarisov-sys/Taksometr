package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * A delivery completion that was requested while the device was offline (or the
 * completeDelivery cloud call failed due to connectivity). It is finalized on
 * the server by [com.zaki.taksometr.service.CompletionSyncWorker] as soon as the
 * network is available again. The route itself is already persisted in the
 * `route_points` table, so we only need the completion parameters here.
 */
@Entity(tableName = "pending_completions")
data class PendingCompletionEntity(
    @PrimaryKey
    val deliveryId: String,
    val courierId: String,
    val waitingMinutes: Double,
    val endTime: Long,
    val enqueuedAt: Long = System.currentTimeMillis()
)
