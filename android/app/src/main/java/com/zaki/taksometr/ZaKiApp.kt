package com.zaki.taksometr

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ZaKiApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        // Flush any deliveries that were completed offline in a previous session
        // once the network is available again.
        com.zaki.taksometr.service.CompletionSyncWorker.schedule(this)
        // Replay the offline operation queue (offline-created deliveries,
        // cancellations, stage changes, buffered location) when online, plus a
        // periodic safety net every 15 minutes.
        com.zaki.taksometr.service.OperationSyncWorker.schedule(this)
        com.zaki.taksometr.service.OperationSyncWorker.schedulePeriodic(this)
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val trackingChannel = NotificationChannel(
                TRACKING_CHANNEL_ID,
                "Отслеживание доставки",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Уведомления во время активной доставки"
            }

            val notificationChannel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Уведомления",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Общие уведомления приложения"
            }

            // Low-key persistent notification shown while the courier is on shift
            // and the continuous location tracker is running.
            val shiftChannel = NotificationChannel(
                SHIFT_CHANNEL_ID,
                "Трекинг на смене",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Фоновое отслеживание местоположения во время смены"
                setShowBadge(false)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(trackingChannel)
            manager.createNotificationChannel(notificationChannel)
            manager.createNotificationChannel(shiftChannel)
        }
    }

    companion object {
        const val TRACKING_CHANNEL_ID = "zaki_tracking"
        const val NOTIFICATION_CHANNEL_ID = "zaki_notifications"
        const val SHIFT_CHANNEL_ID = "zaki_shift"
    }
}
