package com.zaki.taksometr.service

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.zaki.taksometr.R
import com.zaki.taksometr.ZaKiApp
import com.zaki.taksometr.presentation.MainActivity
import com.zaki.taksometr.domain.model.UserRole
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocalizationManager
import com.zaki.taksometr.util.Strings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Coordinates starts on the main thread, including after async repository/FCM work. */
object TrackingController {
    const val EXTRA_SOURCE = "tracking_start_source"
    private const val RECOVERY_NOTIFICATION_ID = 1004
    private fun recoveryKey(kind: TrackingKind) = "tracking_recovery_${kind.name}"
    private val mainHandler = Handler(Looper.getMainLooper())
    private val resumedActivities = mutableSetOf<Activity>()
    @Volatile private var activityResumed = false
    private val mutablePending = MutableStateFlow<Set<TrackingKind>>(emptySet())
    val pending = mutablePending.asStateFlow()

    fun install(application: Application) {
        mutablePending.value = TrackingKind.values().filter { prefs(application).getBoolean(recoveryKey(it), false) }.toSet()
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                resumedActivities.add(activity)
                activityResumed = true
                // Run after Activity lifecycle observers have refreshed permissions.
                mainHandler.post { if (activityResumed) restore(application) }
            }
            override fun onActivityPaused(activity: Activity) {
                resumedActivities.remove(activity)
                activityResumed = resumedActivities.isNotEmpty()
            }
            override fun onActivityDestroyed(activity: Activity) {
                resumedActivities.remove(activity)
                activityResumed = resumedActivities.isNotEmpty()
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        })
    }

    private fun prefs(context: Context) = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

    fun isNeeded(context: Context, kind: TrackingKind): Boolean {
        val prefs = prefs(context)
        if (!prefs.getBoolean(Constants.PREF_IS_LOGGED_IN, false) ||
            prefs.getString(Constants.PREF_USER_ROLE, "") != UserRole.COURIER.name ||
            prefs.getString(Constants.PREF_USER_ID, "").isNullOrEmpty()) return false
        return when (kind) {
            TrackingKind.DELIVERY -> !prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "").isNullOrEmpty()
            TrackingKind.SHIFT -> prefs.getBoolean(Constants.PREF_IS_ON_SHIFT, false)
        }
    }

    fun hasLocation(context: Context) = granted(context, Manifest.permission.ACCESS_FINE_LOCATION) ||
        granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun hasBackgroundLocation(context: Context) = Build.VERSION.SDK_INT < 29 ||
        granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun gpsEnabled(context: Context): Boolean {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return if (Build.VERSION.SDK_INT >= 28) manager.isLocationEnabled
        else manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    private fun decision(context: Context, kind: TrackingKind, source: TrackingStartSource) = TrackingStartPolicy.decide(
        isNeeded(context, kind), hasLocation(context), gpsEnabled(context), activityResumed,
        hasBackgroundLocation(context), Build.VERSION.SDK_INT, source
    )

    fun restore(context: Context, source: TrackingStartSource = TrackingStartSource.VISIBLE_APP) {
        if (isNeeded(context, TrackingKind.DELIVERY)) LocationTrackingService.startService(context, source)
        else LocationTrackingService.stopService(context)
        if (isNeeded(context, TrackingKind.SHIFT)) ShiftTrackingService.start(context, source)
        else ShiftTrackingService.stop(context)
    }

    fun launch(context: Context, kind: TrackingKind, action: String, source: TrackingStartSource) {
        // Re-check eligibility at dispatch time, not before an async network call.
        onMain {
            val appContext = context.applicationContext
            val decision = decision(appContext, kind, source)
            if (decision != TrackingStartDecision.START) {
                if (decision == TrackingStartDecision.NOT_NEEDED) clearPending(appContext, kind)
                else defer(appContext, kind, source, decision.name)
                return@onMain
            }
            val serviceClass = when (kind) {
                TrackingKind.DELIVERY -> LocationTrackingService::class.java
                TrackingKind.SHIFT -> ShiftTrackingService::class.java
            }
            val intent = Intent(appContext, serviceClass).setAction(action).putExtra(EXTRA_SOURCE, source.name)
            diagnostics(appContext, kind, source, "dispatch")
            try {
                ContextCompat.startForegroundService(appContext, intent)
            } catch (e: SecurityException) {
                defer(appContext, kind, source, "dispatch_denied", e)
            } catch (e: IllegalStateException) {
                defer(appContext, kind, source, "dispatch_denied", e)
            }
        }
    }

    fun source(intent: Intent?): TrackingStartSource = if (intent == null) TrackingStartSource.SYSTEM_RESTART
        else TrackingStartSource.values().firstOrNull { it.name == intent.getStringExtra(EXTRA_SOURCE) }
            ?: TrackingStartSource.VISIBLE_APP

    /** Called inside onStartCommand: dispatch catching alone cannot catch promotion failures. */
    fun promote(service: Service, kind: TrackingKind, source: TrackingStartSource, id: Int, notification: Notification): Boolean {
        val decision = decision(service, kind, source)
        if (decision != TrackingStartDecision.START) {
            if (decision == TrackingStartDecision.NOT_NEEDED) clearPending(service, kind)
            else defer(service, kind, source, decision.name)
            return false
        }
        diagnostics(service, kind, source, "promote")
        return try {
            ServiceCompat.startForeground(service, id, notification,
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
            true
        } catch (e: SecurityException) {
            defer(service, kind, source, "promotion_denied", e)
            false
        } catch (e: IllegalStateException) {
            defer(service, kind, source, "promotion_denied", e)
            false
        }
    }

    fun defer(context: Context, kind: TrackingKind, source: TrackingStartSource, stage: String, error: Exception? = null) {
        onMain {
            if (!isNeeded(context, kind)) { clearPending(context, kind); return@onMain }
            prefs(context).edit().putBoolean(recoveryKey(kind), true).apply()
            mutablePending.value = mutablePending.value + kind
            diagnostics(context, kind, source, stage)
            if (error != null) {
                android.util.Log.w("TrackingController", "$kind: $stage", error)
                FirebaseCrashlytics.getInstance().recordException(error)
            }
            if (!activityResumed) showRecoveryNotification(context)
        }
    }

    fun clearPending(context: Context, kind: TrackingKind) {
        onMain {
            prefs(context).edit().remove(recoveryKey(kind)).apply()
            mutablePending.value = mutablePending.value - kind
            if (mutablePending.value.isEmpty()) NotificationManagerCompat.from(context).cancel(RECOVERY_NOTIFICATION_ID)
        }
    }

    private fun diagnostics(context: Context, kind: TrackingKind, source: TrackingStartSource, stage: String) {
        FirebaseCrashlytics.getInstance().apply {
            val prefix = "tracking_${kind.name.lowercase()}"
            setCustomKey("${prefix}_source", source.name)
            setCustomKey("${prefix}_stage", stage)
            setCustomKey("${prefix}_activity_resumed", activityResumed)
            setCustomKey("${prefix}_location", hasLocation(context))
            setCustomKey("${prefix}_fine_location", granted(context, Manifest.permission.ACCESS_FINE_LOCATION))
            setCustomKey("${prefix}_android_api", Build.VERSION.SDK_INT)
            setCustomKey("${prefix}_background_location", hasBackgroundLocation(context))
            setCustomKey("${prefix}_gps", gpsEnabled(context))
            log("$kind tracking: $source / $stage")
        }
    }

    private fun showRecoveryNotification(context: Context) {
        if (Build.VERSION.SDK_INT >= 33 && !granted(context, Manifest.permission.POST_NOTIFICATIONS)) return
        val language = LocalizationManager.getCurrentLanguage(prefs(context)).code
        val content = Strings.trackingRecoveryMessage[language] ?: Strings.trackingRecoveryMessage.getValue("ru")
        val notification = NotificationCompat.Builder(context, ZaKiApp.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_delivery).setContentTitle("ZaKi").setContentText(content)
            .setStyle(NotificationCompat.BigTextStyle().bigText(content)).setAutoCancel(true).setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(context, RECOVERY_NOTIFICATION_ID,
                Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .build()
        try { NotificationManagerCompat.from(context).notify(RECOVERY_NOTIFICATION_ID, notification) }
        catch (_: SecurityException) { /* The in-app notice still remains available. */ }
    }

    fun onMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) action() else mainHandler.post { action() }
    }
}
