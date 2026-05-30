package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.DeliveryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DeliveryDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(delivery: DeliveryEntity)

    @Update
    suspend fun update(delivery: DeliveryEntity)

    @Query("SELECT * FROM deliveries WHERE id = :id")
    suspend fun getById(id: String): DeliveryEntity?

    @Query("SELECT * FROM deliveries WHERE status = 'IN_PROGRESS' AND courierId = :courierId LIMIT 1")
    fun getActiveDelivery(courierId: String): Flow<DeliveryEntity?>

    @Query("SELECT * FROM deliveries WHERE courierId = :courierId ORDER BY createdAt DESC")
    fun getDeliveriesByCourier(courierId: String): Flow<List<DeliveryEntity>>

    @Query("SELECT * FROM deliveries WHERE clientPhone LIKE '%' || :phone || '%' AND courierId = :courierId ORDER BY createdAt DESC")
    fun searchByPhone(phone: String, courierId: String): Flow<List<DeliveryEntity>>

    @Query("SELECT * FROM deliveries WHERE createdAt BETWEEN :startDate AND :endDate AND courierId = :courierId ORDER BY createdAt DESC")
    fun getByDateRange(startDate: Long, endDate: Long, courierId: String): Flow<List<DeliveryEntity>>

    @Query("SELECT COUNT(*) FROM deliveries WHERE courierId = :courierId AND status = 'COMPLETED' AND createdAt >= :todayStart")
    fun getTodayDeliveryCount(courierId: String, todayStart: Long): Flow<Int>

    @Query("SELECT COALESCE(SUM(cost), 0.0) FROM deliveries WHERE courierId = :courierId AND status = 'COMPLETED' AND createdAt >= :todayStart")
    fun getTodayEarnings(courierId: String, todayStart: Long): Flow<Double>

    @Query("SELECT * FROM deliveries WHERE isSynced = 0")
    suspend fun getUnsyncedDeliveries(): List<DeliveryEntity>

    @Query("UPDATE deliveries SET isSynced = 1 WHERE id = :id")
    suspend fun markAsSynced(id: String)
}
