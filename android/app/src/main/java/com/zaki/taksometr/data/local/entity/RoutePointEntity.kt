package com.zaki.taksometr.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.zaki.taksometr.domain.model.GeoPoint

@Entity(tableName = "route_points")
data class RoutePointEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val deliveryId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val timestamp: Long,
    val isSynced: Boolean = false
) {
    fun toGeoPoint(): GeoPoint = GeoPoint(
        latitude = latitude,
        longitude = longitude,
        timestamp = timestamp,
        accuracy = accuracy
    )

    companion object {
        fun fromGeoPoint(point: GeoPoint, deliveryId: String): RoutePointEntity =
            RoutePointEntity(
                deliveryId = deliveryId,
                latitude = point.latitude,
                longitude = point.longitude,
                accuracy = point.accuracy,
                timestamp = point.timestamp
            )
    }
}
