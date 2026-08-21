package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import org.json.JSONObject

/**
 * One operation that the courier performed while offline (or whose network call
 * failed due to connectivity). It is replayed against Firebase by
 * [com.zaki.taksometr.service.OperationSyncWorker] as soon as the network is
 * available again.
 *
 * Idempotency:
 *  - CREATE_DELIVERY uses the client-generated delivery id as the Firestore
 *    document id, so replaying it can never create a duplicate order.
 *  - CANCEL_DELIVERY / MARKETPLACE_STAGE set absolute state on the server, so a
 *    replay is safe.
 *  - COURIER_LOCATION uses the fixed id [LOCATION_OP_ID] with REPLACE, so only
 *    the latest known position is ever buffered.
 */
@Entity(tableName = "pending_operations")
data class PendingOperationEntity(
    @PrimaryKey
    val id: String,
    val type: String,
    val payload: String,
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0
) {
    fun payloadJson(): JSONObject = JSONObject(payload)

    companion object {
        const val TYPE_CREATE_DELIVERY = "CREATE_DELIVERY"
        const val TYPE_CANCEL_DELIVERY = "CANCEL_DELIVERY"
        const val TYPE_MARKETPLACE_STAGE = "MARKETPLACE_STAGE"
        const val TYPE_COURIER_LOCATION = "COURIER_LOCATION"

        /** Fixed row id for the buffered courier position (latest wins). */
        const val LOCATION_OP_ID = "courier_location"
    }
}
