package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.ChainDeliveryItemEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ChainDeliveryItemDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: ChainDeliveryItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<ChainDeliveryItemEntity>)

    @Update
    suspend fun update(item: ChainDeliveryItemEntity)

    @Delete
    suspend fun delete(item: ChainDeliveryItemEntity)

    @Query("SELECT * FROM chain_delivery_items WHERE id = :id")
    suspend fun getById(id: String): ChainDeliveryItemEntity?

    @Query("SELECT * FROM chain_delivery_items WHERE chainId = :chainId ORDER BY sequenceOrder ASC")
    fun getItemsByChainId(chainId: String): Flow<List<ChainDeliveryItemEntity>>

    @Query("SELECT * FROM chain_delivery_items WHERE chainId = :chainId ORDER BY sequenceOrder ASC")
    suspend fun getItemsByChainIdSync(chainId: String): List<ChainDeliveryItemEntity>

    @Query("SELECT * FROM chain_delivery_items WHERE chainId = :chainId AND status = 'IN_PROGRESS' LIMIT 1")
    fun getCurrentItem(chainId: String): Flow<ChainDeliveryItemEntity?>

    @Query("DELETE FROM chain_delivery_items WHERE chainId = :chainId")
    suspend fun deleteByChainId(chainId: String)

    @Query("UPDATE chain_delivery_items SET sequenceOrder = :newOrder WHERE id = :itemId")
    suspend fun updateSequenceOrder(itemId: String, newOrder: Int)
}
