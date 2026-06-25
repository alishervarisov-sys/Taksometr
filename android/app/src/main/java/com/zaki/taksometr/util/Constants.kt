package com.zaki.taksometr.util

object Constants {
    // Firestore Collections
    const val COLLECTION_USERS = "users"
    const val COLLECTION_DELIVERIES = "deliveries"
    const val COLLECTION_TARIFFS = "tariffs"
    const val COLLECTION_SETTINGS = "settings"
    const val COLLECTION_NOTIFICATIONS = "notifications"

    // Location
    const val LOCATION_UPDATE_INTERVAL = 3000L // 3 seconds
    const val LOCATION_FASTEST_INTERVAL = 2000L
    const val LOCATION_MIN_DISPLACEMENT = 3f // meters

    // Preferences
    const val PREFS_NAME = "zaki_prefs"
    const val PREF_USER_ID = "user_id"
    const val PREF_USER_NAME = "user_name"
    const val PREF_IS_LOGGED_IN = "is_logged_in"
    const val PREF_ACTIVE_DELIVERY_ID = "active_delivery_id"
    const val PREF_PENDING_MARKETPLACE_DELIVERY_ID = "pending_marketplace_delivery_id"

    // Notification
    const val TRACKING_NOTIFICATION_ID = 1001
    const val SERVICE_NOTIFICATION_ID = 1002

    // WorkManager
    const val SYNC_WORK_NAME = "route_sync_work"
    const val LOCATION_WORK_NAME = "location_work"
}
