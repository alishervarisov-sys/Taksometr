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
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.repository.AuthRepositoryImpl
import com.zaki.taksometr.data.repository.DeliveryRepositoryImpl
import com.zaki.taksometr.data.repository.LocationRepositoryImpl
import com.zaki.taksometr.data.repository.TariffRepositoryImpl
import com.zaki.taksometr.domain.repository.AuthRepository
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
        .addMigrations(MIGRATION_1_2)
        .fallbackToDestructiveMigration()
        .build()
    
    private val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
        override fun migrate(database: androidx.sqlite.db.SupportSQLiteDatabase) {
            database.execSQL("ALTER TABLE deliveries ADD COLUMN deliveryType TEXT NOT NULL DEFAULT 'default'")
            database.execSQL("ALTER TABLE deliveries ADD COLUMN fixedPrice REAL")
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
    ): DeliveryRepository = DeliveryRepositoryImpl(firestore, functions, deliveryDao, routePointDao, prefs)

    @Provides
    @Singleton
    fun provideLocationRepository(
        @ApplicationContext context: Context,
        fusedLocationClient: FusedLocationProviderClient,
        routePointDao: RoutePointDao,
        firestore: FirebaseFirestore
    ): LocationRepository = LocationRepositoryImpl(context, fusedLocationClient, routePointDao, firestore)

    @Provides
    @Singleton
    fun provideTariffRepository(
        firestore: FirebaseFirestore,
        functions: FirebaseFunctions
    ): TariffRepository = TariffRepositoryImpl(firestore, functions)
}
