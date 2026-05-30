package com.zaki.taksometr.service

import android.content.Context
import android.content.SharedPreferences
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.google.firebase.firestore.FirebaseFirestore
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.util.Constants
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

@HiltWorker
class RouteSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val routePointDao: RoutePointDao,
    private val firestore: FirebaseFirestore,
    private val prefs: SharedPreferences
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val deliveryId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, null)
            ?: return Result.success()

        return try {
            // Get unsynced points
            val unsyncedPoints = routePointDao.getUnsyncedPoints(deliveryId)
            if (unsyncedPoints.isEmpty()) return Result.success()

            // Batch update to Firestore
            val batch = firestore.batch()
            val deliveryRef = firestore.collection(Constants.COLLECTION_DELIVERIES).document(deliveryId)

            val routeData = unsyncedPoints.map { point ->
                hashMapOf(
                    "latitude" to point.latitude,
                    "longitude" to point.longitude,
                    "timestamp" to point.timestamp,
                    "accuracy" to point.accuracy
                )
            }

            // Update route in delivery document (append)
            batch.update(deliveryRef, "route", com.google.firebase.firestore.FieldValue.arrayUnion(*routeData.toTypedArray()))
            batch.commit()

            // Mark as synced
            routePointDao.markAsSynced(unsyncedPoints.map { it.id })

            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<RouteSyncWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    Constants.SYNC_WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    workRequest
                )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context)
                .cancelUniqueWork(Constants.SYNC_WORK_NAME)
        }
    }
}
