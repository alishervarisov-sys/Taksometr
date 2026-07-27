package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.PendingCompletionEntity

@Dao
interface PendingCompletionDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: PendingCompletionEntity)

    @Query("SELECT * FROM pending_completions ORDER BY enqueuedAt ASC")
    suspend fun getAll(): List<PendingCompletionEntity>

    @Query("SELECT COUNT(*) FROM pending_completions")
    suspend fun count(): Int

    @Query("DELETE FROM pending_completions WHERE deliveryId = :deliveryId")
    suspend fun deleteById(deliveryId: String)
}
