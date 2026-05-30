package com.zaki.taksometr.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.zaki.taksometr.R
import com.zaki.taksometr.presentation.MainActivity

/**
 * Home-screen widget that shows the current active delivery status:
 * distance, elapsed time and live cost. State is written to SharedPreferences
 * by the LocationTrackingService and read here on each update.
 */
class TaksometrWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
            val isActive = prefs.getBoolean(KEY_ACTIVE, false)
            val distance = prefs.getString(KEY_DISTANCE, "0 м") ?: "0 м"
            val time = prefs.getString(KEY_TIME, "0:00") ?: "0:00"
            val cost = prefs.getString(KEY_COST, "0 сум") ?: "0 сум"
            val phone = prefs.getString(KEY_PHONE, "") ?: ""

            val views = RemoteViews(context.packageName, R.layout.widget_taksometr)

            if (isActive) {
                views.setViewVisibility(R.id.widget_active_layout, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_idle_layout, android.view.View.GONE)
                views.setTextViewText(R.id.widget_distance, distance)
                views.setTextViewText(R.id.widget_time, time)
                views.setTextViewText(R.id.widget_cost, cost)
                views.setTextViewText(R.id.widget_phone, "Клиент: $phone")
            } else {
                views.setViewVisibility(R.id.widget_active_layout, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_idle_layout, android.view.View.VISIBLE)
            }

            // Tap opens the app
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        /**
         * Called by the tracking service to push fresh data to all widgets.
         */
        fun pushUpdate(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, TaksometrWidgetProvider::class.java)
            )
            for (id in ids) {
                updateWidget(context, manager, id)
            }
        }

        const val WIDGET_PREFS = "zaki_widget_prefs"
        const val KEY_ACTIVE = "widget_active"
        const val KEY_DISTANCE = "widget_distance"
        const val KEY_TIME = "widget_time"
        const val KEY_COST = "widget_cost"
        const val KEY_PHONE = "widget_phone"
    }
}
