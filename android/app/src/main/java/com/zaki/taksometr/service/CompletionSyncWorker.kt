package com.zaki.taksometr.service

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
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
 * Flushes the offline completion queue (`pending_completions`) once the network
 * is available. Deliveries that the courier completed while offline are finalized
 * on the server here.
 *
 * Uses a Hilt [EntryPoint] to obtain the [DeliveryRepository] instead of
 * `@HiltWorker`, so no custom WorkManager configuration/initialization is
 * required in the Application class.
 */
class CompletionSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface CompletionSyncEntryPoint {
        fun deliveryRepository(): DeliveryRepository
    }

    override suspend fun doWork(): Result {
        val entryPoint = EntryPointAccessors.fromApplication(
            applicationContext,
            CompletionSyncEntryPoint::class.java
        )
        val repository = entryPoint.deliveryRepository()

        return when (repository.syncPendingCompletions()) {
            is Resource.Success -> Result.success()
            // Something is still pending (e.g. transient server/network error);
            // ask WorkManager to retry with backoff while we still have network.
            else -> Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "completion_sync"

        /**
         * Schedules a one-time flush of the offline completion queue that runs as
         * soon as the device has a network connection. Safe to call repeatedly:
         * the work is unique and kept if already enqueued/running.
         */
        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<CompletionSyncWorker>()
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
    }
}
