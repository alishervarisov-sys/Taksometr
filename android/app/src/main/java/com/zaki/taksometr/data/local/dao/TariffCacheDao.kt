package com.zaki.taksometr.data.local.dao

import androidx.room.*
import com.zaki.taksometr.data.local.entity.TariffCacheEntity

@Dao
interface TariffCacheDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(cache: TariffCacheEntity)

    @Query("SELECT * FROM tariff_cache WHERE id = 'default'")
    suspend fun get(): TariffCacheEntity?

    @Query("SELECT * FROM tariff_cache WHERE id = 'default'")
    fun observe(): kotlinx.coroutines.flow.Flow<TariffCacheEntity?>
}
