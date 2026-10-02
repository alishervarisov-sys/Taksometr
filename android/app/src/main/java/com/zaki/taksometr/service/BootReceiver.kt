package com.zaki.taksometr.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            // Check each tracker independently; denied starts wait for a visible Activity.
            TrackingController.restore(context, TrackingStartSource.BOOT)
        }
    }
}
