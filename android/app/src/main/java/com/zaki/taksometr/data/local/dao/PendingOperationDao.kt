package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.PendingOperationEntity

@Dao
interface PendingOperationDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(op: PendingOperationEntity)

    @Query("SELECT * FROM pending_operations ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingOperationEntity>

    @Query("SELECT * FROM pending_operations WHERE id = :id")
    suspend fun getById(id: String): PendingOperationEntity?

    @Query("SELECT COUNT(*) FROM pending_operations")
    suspend fun count(): Int

    @Query("DELETE FROM pending_operations WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("UPDATE pending_operations SET attempts = attempts + 1 WHERE id = :id")
    suspend fun incrementAttempts(id: String)
}
