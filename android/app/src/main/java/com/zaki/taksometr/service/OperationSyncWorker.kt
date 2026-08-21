package com.zaki.taksometr.service

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Resource
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit

/**
 * Flushes the offline operation queue (`pending_operations`: offline-created
 * deliveries, cancellations, marketplace stage changes and the buffered
 * courier position) once the network is available, then also finalizes any
 * offline completions via the existing pending-completions queue.
 *
 * Uses a Hilt [EntryPoint] to obtain the [DeliveryRepository] instead of
 * `@HiltWorker`, so no custom WorkManager configuration is required (same
 * pattern as [CompletionSyncWorker]).
 */
class OperationSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface OperationSyncEntryPoint {
        fun deliveryRepository(): DeliveryRepository
    }

    override suspend fun doWork(): Result {
        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            OperationSyncEntryPoint::class.java
        )
        val repository = entryPoint.deliveryRepository()

        return when (repository.syncPendingOperations()) {
            is Resource.Success -> Result.success()
            // Something is still pending (transient server/network error);
            // ask WorkManager to retry with backoff while we still have network.
            else -> Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "operation_sync"

        /**
         * Schedules a one-time flush of the offline operation queue that runs as
         * soon as the device has a network connection. Safe to call repeatedly:
         * the work is unique and kept if already enqueued/running.
         */
        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<OperationSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        /**
         * Periodic safety net: even if the one-time scheduling is missed (e.g.
         * the process was killed right after enqueueing an offline operation),
         * the queue is flushed at least every 15 minutes while online.
         */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<OperationSyncWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    "${UNIQUE_WORK_NAME}_periodic",
                    ExistingPeriodicWorkPolicy.KEEP,
                    request
                )
        }
    }
}
