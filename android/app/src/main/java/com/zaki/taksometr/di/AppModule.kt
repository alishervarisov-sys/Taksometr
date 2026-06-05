package com.zaki.taksometr.di

import android.content.Context
import android.content.SharedPreferences
import androidx.room.Room
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.messaging.FirebaseMessaging
import com.zaki.taksometr.data.local.ZaKiDatabase
import com.zaki.taksometr.data.local.dao.ChainDeliveryItemDao
import com.zaki.taksometr.data.local.dao.DeliveryChainDao
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.repository.AuthRepositoryImpl
import com.zaki.taksometr.data.repository.DeliveryChainRepositoryImpl
import com.zaki.taksometr.data.repository.DeliveryRepositoryImpl
import com.zaki.taksometr.data.repository.LocationRepositoryImpl
import com.zaki.taksometr.data.repository.TariffRepositoryImpl
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryChainRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.LocationRepository
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.util.Constants
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideFirestore(): FirebaseFirestore = FirebaseFirestore.getInstance()

    @Provides
    @Singleton
    fun provideFirebaseFunctions(): FirebaseFunctions = FirebaseFunctions.getInstance()

    @Provides
    @Singleton
    fun provideFirebaseMessaging(): FirebaseMessaging = FirebaseMessaging.getInstance()

    @Provides
    @Singleton
    fun provideFusedLocationClient(
        @ApplicationContext context: Context
    ): FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)

    @Provides
    @Singleton
    fun provideSharedPreferences(
        @ApplicationContext context: Context
    ): SharedPreferences = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context
    ): ZaKiDatabase = Room.databaseBuilder(
        context,
        ZaKiDatabase::class.java,
        "zaki_database"
    )
        .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
        .fallbackToDestructiveMigration()
        .build()

    private val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
        override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE deliveries ADD COLUMN deliveryType TEXT NOT NULL DEFAULT 'default'")
            db.execSQL("ALTER TABLE deliveries ADD COLUMN fixedPrice REAL")
        }
    }

    private val MIGRATION_2_3 = object : androidx.room.migration.Migration(2, 3) {
        override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS delivery_chains (
                    id TEXT NOT NULL PRIMARY KEY,
                    courierId TEXT NOT NULL,
                    courierName TEXT NOT NULL,
                    status TEXT NOT NULL,
                    createdAt INTEGER NOT NULL,
                    startedAt INTEGER,
                    completedAt INTEGER,
                    totalDistance REAL NOT NULL DEFAULT 0.0,
                    totalCost REAL NOT NULL DEFAULT 0.0,
                    isSynced INTEGER NOT NULL DEFAULT 0
                )
            """.trimIndent())
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS chain_delivery_items (
                    id TEXT NOT NULL PRIMARY KEY,
                    chainId TEXT NOT NULL,
                    clientPhone TEXT NOT NULL,
                    orderNumber TEXT NOT NULL,
                    sequenceOrder INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    deliveryId TEXT,
                    startTime INTEGER,
                    endTime INTEGER,
                    distanceMeters REAL NOT NULL DEFAULT 0.0,
                    cost REAL NOT NULL DEFAULT 0.0,
                    deliveryType TEXT NOT NULL DEFAULT 'default',
                    fixedPrice REAL,
                    createdAt INTEGER NOT NULL,
                    FOREIGN KEY(chainId) REFERENCES delivery_chains(id) ON DELETE CASCADE
                )
            """.trimIndent())
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS index_chain_delivery_items_chainId ON chain_delivery_items(chainId)"
            )
        }
    }

    @Provides
    @Singleton
    fun provideRoutePointDao(database: ZaKiDatabase): RoutePointDao = database.routePointDao()

    @Provides
    @Singleton
    fun provideDeliveryDao(database: ZaKiDatabase): DeliveryDao = database.deliveryDao()

    @Provides
    @Singleton
    fun provideDeliveryChainDao(database: ZaKiDatabase): DeliveryChainDao =
        database.deliveryChainDao()

    @Provides
    @Singleton
    fun provideChainDeliveryItemDao(database: ZaKiDatabase): ChainDeliveryItemDao =
        database.chainDeliveryItemDao()

    @Provides
    @Singleton
    fun provideAuthRepository(
        firestore: FirebaseFirestore,
        prefs: SharedPreferences
    ): AuthRepository = AuthRepositoryImpl(firestore, prefs)

    @Provides
    @Singleton
    fun provideDeliveryRepository(
        firestore: FirebaseFirestore,
        functions: FirebaseFunctions,
        deliveryDao: DeliveryDao,
        routePointDao: RoutePointDao,
        prefs: SharedPreferences
    ): DeliveryRepository = DeliveryRepositoryImpl(
        firestore, functions, deliveryDao, routePointDao, prefs
    )

    @Provides
    @Singleton
    fun provideDeliveryChainRepository(
        firestore: FirebaseFirestore,
        functions: FirebaseFunctions,
        chainDao: DeliveryChainDao,
        itemDao: ChainDeliveryItemDao,
        routePointDao: RoutePointDao,
        prefs: SharedPreferences
    ): DeliveryChainRepository = DeliveryChainRepositoryImpl(
        firestore, functions, chainDao, itemDao, routePointDao, prefs
    )

    @Provides
    @Singleton
    fun provideLocationRepository(
        @ApplicationContext context: Context,
        fusedLocationClient: FusedLocationProviderClient,
        routePointDao: RoutePointDao,
        firestore: FirebaseFirestore
    ): LocationRepository = LocationRepositoryImpl(
        context, fusedLocationClient, routePointDao, firestore
    )

    @Provides
    @Singleton
    fun provideTariffRepository(
        firestore: FirebaseFirestore,
        functions: FirebaseFunctions
    ): TariffRepository = TariffRepositoryImpl(firestore, functions)
}
