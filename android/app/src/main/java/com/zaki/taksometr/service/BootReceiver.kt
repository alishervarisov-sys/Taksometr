package com.zaki.taksometr.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.zaki.taksometr.util.Constants

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

            // Restart the delivery meter if a delivery was in progress at reboot.
            // Starting a foreground service from BOOT_COMPLETED can be blocked on
            // some OS versions; if so, tracking resumes when the app is opened.
            try {
                val activeDeliveryId = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, null)
                if (!activeDeliveryId.isNullOrEmpty()) {
                    LocationTrackingService.startService(context)
                }

                // Resume continuous shift tracking if the courier is logged in and
                // on shift, so a reboot doesn't create a blind spot in their route.
                val loggedIn = prefs.getBoolean(Constants.PREF_IS_LOGGED_IN, false)
                val onShift = prefs.getBoolean(Constants.PREF_IS_ON_SHIFT, false)
                if (loggedIn && onShift) {
                    ShiftTrackingService.start(context)
                }
            } catch (_: Exception) {}
        }
    }
}
