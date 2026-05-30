package com.zaki.taksometr.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.zaki.taksometr.util.Constants

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            // Check if there was an active delivery
            val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            val activeDeliveryId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, null)

            if (!activeDeliveryId.isNullOrEmpty()) {
                // Restart tracking service
                LocationTrackingService.startService(context)
            }
        }
    }
}
