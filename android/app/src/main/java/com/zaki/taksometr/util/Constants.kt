package com.zaki.taksometr.util

object Constants {
    // Firestore Collections
    const val COLLECTION_USERS = "users"
    const val COLLECTION_DELIVERIES = "deliveries"
    const val COLLECTION_TARIFFS = "tariffs"
    const val COLLECTION_SETTINGS = "settings"
    const val COLLECTION_NOTIFICATIONS = "notifications"
    const val COLLECTION_WINNER_ANNOUNCEMENTS = "winner_announcements"

    // Location
    const val LOCATION_UPDATE_INTERVAL = 3000L // 3 seconds
    const val LOCATION_FASTEST_INTERVAL = 2000L
    const val LOCATION_MIN_DISPLACEMENT = 3f // meters

    // Radius (in meters) within which a courier is considered to have "arrived"
    // at the admin-defined pickup point. The courier cannot advance the order
    // stage past ACCEPTED until inside this radius, and the ARRIVED_PICKUP stage
    // is set automatically once the courier enters it.
    const val PICKUP_ARRIVAL_RADIUS_METERS = 150.0

    // Preferences
    const val PREFS_NAME = "zaki_prefs"
    const val PREF_USER_ID = "user_id"
    const val PREF_USER_NAME = "user_name"
    const val PREF_IS_LOGGED_IN = "is_logged_in"
    const val PREF_ACTIVE_DELIVERY_ID = "active_delivery_id"
    const val PREF_PENDING_MARKETPLACE_DELIVERY_ID = "pending_marketplace_delivery_id"
    const val PREF_ON_THE_WAY_STARTED_AT = "on_the_way_started_at"
    // Last winner-of-the-month announcement the courier has already dismissed,
    // so the congratulation dialog is not shown again on every app launch.
    const val PREF_LAST_SEEN_WINNER_ANNOUNCEMENT_ID = "last_seen_winner_announcement_id"

    // Notification
    const val TRACKING_NOTIFICATION_ID = 1001
    const val SERVICE_NOTIFICATION_ID = 1002

    // WorkManager
    const val SYNC_WORK_NAME = "route_sync_work"
    const val LOCATION_WORK_NAME = "location_work"

    // Maximum number of deliveries a courier can have IN_PROGRESS at once.
    // One is "current" (meter running); the others are paused.
    const val MAX_CONCURRENT_DELIVERIES = 2
}
