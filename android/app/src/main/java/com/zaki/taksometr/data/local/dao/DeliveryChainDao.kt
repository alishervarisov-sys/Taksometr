package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.DeliveryChainEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DeliveryChainDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(chain: DeliveryChainEntity)

    @Update
    suspend fun update(chain: DeliveryChainEntity)

    @Delete
    suspend fun delete(chain: DeliveryChainEntity)

    @Query("SELECT * FROM delivery_chains WHERE id = :id")
    suspend fun getById(id: String): DeliveryChainEntity?

    @Query("SELECT * FROM delivery_chains WHERE id = :id")
    fun getByIdFlow(id: String): Flow<DeliveryChainEntity?>

    @Query("SELECT * FROM delivery_chains WHERE courierId = :courierId ORDER BY createdAt DESC")
    fun getChainsByCourier(courierId: String): Flow<List<DeliveryChainEntity>>

    @Query("SELECT * FROM delivery_chains WHERE status = 'IN_PROGRESS' AND courierId = :courierId LIMIT 1")
    fun getActiveChain(courierId: String): Flow<DeliveryChainEntity?>

    @Query("SELECT * FROM delivery_chains WHERE status = 'DRAFT' AND courierId = :courierId ORDER BY createdAt DESC")
    fun getDraftChains(courierId: String): Flow<List<DeliveryChainEntity>>

    @Query("SELECT * FROM delivery_chains WHERE isSynced = 0")
    suspend fun getUnsyncedChains(): List<DeliveryChainEntity>

    @Query("UPDATE delivery_chains SET isSynced = 1 WHERE id = :id")
    suspend fun markAsSynced(id: String)
}
