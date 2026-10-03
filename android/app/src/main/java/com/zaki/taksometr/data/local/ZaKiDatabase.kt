package com.zaki.taksometr.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.zaki.taksometr.data.local.dao.ChainDeliveryItemDao
import com.zaki.taksometr.data.local.dao.DeliveryChainDao
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.PendingCompletionDao
import com.zaki.taksometr.data.local.dao.PendingOperationDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.dao.TariffCacheDao
import com.zaki.taksometr.data.local.entity.ChainDeliveryItemEntity
import com.zaki.taksometr.data.local.entity.DeliveryChainEntity
import com.zaki.taksometr.data.local.entity.DeliveryEntity
import com.zaki.taksometr.data.local.entity.PendingCompletionEntity
import com.zaki.taksometr.data.local.entity.PendingOperationEntity
import com.zaki.taksometr.data.local.entity.RoutePointEntity
import com.zaki.taksometr.data.local.entity.TariffCacheEntity

@Database(
    entities = [
        RoutePointEntity::class,
        DeliveryEntity::class,
        DeliveryChainEntity::class,
        ChainDeliveryItemEntity::class,
        PendingCompletionEntity::class,
        PendingOperationEntity::class,
        TariffCacheEntity::class
    ],
    version = 10,
    exportSchema = false
)
abstract class ZaKiDatabase : RoomDatabase() {
    abstract fun routePointDao(): RoutePointDao
    abstract fun deliveryDao(): DeliveryDao
    abstract fun deliveryChainDao(): DeliveryChainDao
    abstract fun chainDeliveryItemDao(): ChainDeliveryItemDao
    abstract fun pendingCompletionDao(): PendingCompletionDao
    abstract fun pendingOperationDao(): PendingOperationDao
    abstract fun tariffCacheDao(): TariffCacheDao
}
