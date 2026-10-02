package com.zaki.taksometr.util

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.core.app.NotificationCompat
import com.zaki.taksometr.R
import com.zaki.taksometr.ZaKiApp
import com.zaki.taksometr.presentation.MainActivity

object BalanceNotification {
    const val ID = 71010
    const val ACTION_TOP_UP = "com.zaki.taksometr.TOP_UP_BALANCE"
    const val EXTRA_COURIER_ID = "balance_courier_id"

    @Synchronized
    fun acceptEvent(prefs: SharedPreferences, courierId: String, eventAt: Double): Boolean {
        val key = "balance_notification_event_$courierId"
        val latest = prefs.getString(key, null)?.toDoubleOrNull() ?: 0.0
        if (!eventAt.isFinite() || eventAt <= latest) return false
        prefs.edit().putString(key, eventAt.toString()).apply()
        return true
    }

    fun isCurrentEvent(prefs: SharedPreferences, courierId: String, eventAt: Double): Boolean =
        prefs.getString("balance_notification_event_$courierId", null)?.toDoubleOrNull() == eventAt

    fun show(context: Context, courierId: String, title: String, body: String) {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = ACTION_TOP_UP
            putExtra(EXTRA_COURIER_ID, courierId)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val action = PendingIntent.getActivity(context, ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, ZaKiApp.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(action)
            .addAction(R.drawable.ic_notification, "Пополнить баланс", action)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID, notification)
    }

    fun clear(context: Context) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ID)
    }
}
