package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.GeoPoint
import kotlinx.coroutines.flow.Flow

interface LocationRepository {
    fun getLocationUpdates(): Flow<GeoPoint>
    fun getRoutePoints(): Flow<List<GeoPoint>>
    suspend fun saveRoutePoint(point: GeoPoint)
    suspend fun clearRoute()
    fun getTotalDistance(): Flow<Double>
    suspend fun updateCourierLocation(courierId: String, point: GeoPoint)
}
