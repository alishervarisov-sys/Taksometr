package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.RoutePointEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface RoutePointDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(point: RoutePointEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(points: List<RoutePointEntity>)

    @Query("SELECT * FROM route_points WHERE deliveryId = :deliveryId ORDER BY timestamp ASC")
    fun getPointsByDeliveryId(deliveryId: String): Flow<List<RoutePointEntity>>

    @Query("SELECT * FROM route_points WHERE deliveryId = :deliveryId ORDER BY timestamp ASC")
    suspend fun getPointsByDeliveryIdSync(deliveryId: String): List<RoutePointEntity>

    @Query("SELECT * FROM route_points WHERE isSynced = 0 AND deliveryId = :deliveryId")
    suspend fun getUnsyncedPoints(deliveryId: String): List<RoutePointEntity>

    @Query("UPDATE route_points SET isSynced = 1 WHERE id IN (:ids)")
    suspend fun markAsSynced(ids: List<Long>)

    @Query("DELETE FROM route_points WHERE deliveryId = :deliveryId")
    suspend fun deleteByDeliveryId(deliveryId: String)

    @Query("SELECT COUNT(*) FROM route_points WHERE deliveryId = :deliveryId")
    suspend fun getPointCount(deliveryId: String): Int
}
