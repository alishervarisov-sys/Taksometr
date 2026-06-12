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

    @Delete
    suspend fun delete(delivery: DeliveryEntity)

    @Query("SELECT * FROM deliveries WHERE id = :id")
    suspend fun getById(id: String): DeliveryEntity?

    @Query("SELECT * FROM deliveries WHERE id = :id")
    fun getByIdFlow(id: String): Flow<DeliveryEntity?>

    @Query("SELECT * FROM deliveries WHERE courierId = :courierId AND status = 'IN_PROGRESS' LIMIT 1")
    fun getActiveDelivery(courierId: String): Flow<DeliveryEntity?>

    @Query("SELECT * FROM deliveries WHERE courierId = :courierId AND status = 'IN_PROGRESS' LIMIT 1")
    suspend fun getActiveDeliverySync(courierId: String): DeliveryEntity?

    @Query("SELECT * FROM deliveries WHERE courierId = :courierId ORDER BY startTime DESC")
    fun getDeliveriesByCourier(courierId: String): Flow<List<DeliveryEntity>>

    @Query("SELECT * FROM deliveries WHERE clientPhone LIKE '%' || :phone || '%' AND courierId = :courierId ORDER BY startTime DESC")
    fun searchByPhone(phone: String, courierId: String): Flow<List<DeliveryEntity>>

    @Query("SELECT * FROM deliveries WHERE startTime >= :startDate AND startTime <= :endDate AND courierId = :courierId ORDER BY startTime DESC")
    fun getByDateRange(startDate: Long, endDate: Long, courierId: String): Flow<List<DeliveryEntity>>

    @Query("SELECT COUNT(*) FROM deliveries WHERE courierId = :courierId AND startTime >= :todayStart AND status = 'COMPLETED'")
    fun getTodayDeliveryCount(courierId: String, todayStart: Long): Flow<Int>

    @Query("SELECT COALESCE(SUM(cost), 0) FROM deliveries WHERE courierId = :courierId AND startTime >= :todayStart AND status = 'COMPLETED'")
    fun getTodayEarnings(courierId: String, todayStart: Long): Flow<Double>

    @Query("DELETE FROM deliveries WHERE id = :id")
    suspend fun deleteById(id: String)
}
