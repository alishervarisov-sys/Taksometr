package com.zaki.taksometr.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.DeliveryEntity
import com.zaki.taksometr.data.local.entity.RoutePointEntity

@Database(
    entities = [RoutePointEntity::class, DeliveryEntity::class],
    version = 2,
    exportSchema = false
)
abstract class ZaKiDatabase : RoomDatabase() {
    abstract fun routePointDao(): RoutePointDao
    abstract fun deliveryDao(): DeliveryDao
}
