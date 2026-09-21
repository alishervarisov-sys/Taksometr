package com.zaki.taksometr.util

object Constants {
    // Firestore Collections
    const val COLLECTION_USERS = "users"
    const val COLLECTION_DELIVERIES = "deliveries"
    const val COLLECTION_TARIFFS = "tariffs"
    const val COLLECTION_SETTINGS = "settings"
    const val COLLECTION_NOTIFICATIONS = "notifications"
    const val COLLECTION_WINNER_ANNOUNCEMENTS = "winner_announcements"
    // Continuous courier location breadcrumbs: courier_tracks/{courierId}/points/{id}
    const val COLLECTION_COURIER_TRACKS = "courier_tracks"
    const val SUBCOLLECTION_TRACK_POINTS = "points"
    // Settings document holding the minimum required courier-app version.
    const val SETTINGS_DOC_APP_VERSION = "appVersion"

    // Location
    const val LOCATION_UPDATE_INTERVAL = 3000L // 3 seconds
    const val LOCATION_FASTEST_INTERVAL = 2000L
    const val LOCATION_MIN_DISPLACEMENT = 3f // meters

    // Continuous "on shift" tracking (runs whenever the courier is on shift,
    // independent of whether an order/meter is running). Lower frequency than the
    // delivery meter to save battery and Firestore writes.
    const val SHIFT_TRACK_UPDATE_INTERVAL = 25000L // 25 seconds
    const val SHIFT_TRACK_FASTEST_INTERVAL = 15000L
    const val SHIFT_TRACK_MIN_DISPLACEMENT = 15f // meters
    // Minimum spacing between breadcrumbs actually persisted to Firestore.
    const val SHIFT_TRACK_MIN_WRITE_INTERVAL = 20000L
    // Continuous breadcrumbs are kept for this many days (Firestore TTL on
    // `expireAt`), then auto-deleted to bound storage/cost.
    const val TRACK_RETENTION_DAYS = 30L

    // Radius (in meters) within which a courier is considered to have "arrived"
    // at the admin-defined pickup point. Entering this radius starts the trip
    // to the client and the marketplace distance meter.
    const val PICKUP_ARRIVAL_RADIUS_METERS = 200.0

    // Preferences
    const val PREFS_NAME = "zaki_prefs"
    const val PREF_USER_ID = "user_id"
    const val PREF_USER_NAME = "user_name"
    const val PREF_USER_ROLE = "user_role"
    const val PREF_IS_LOGGED_IN = "is_logged_in"
    const val PREF_ACTIVE_DELIVERY_ID = "active_delivery_id"
    // Mirror of the courier's Firestore `isOnShift` flag, so the tracking service
    // and BootReceiver can decide whether to run without a network round-trip.
    const val PREF_IS_ON_SHIFT = "is_on_shift"
    const val PREF_PENDING_MARKETPLACE_DELIVERY_ID = "pending_marketplace_delivery_id"
    const val PREF_ON_THE_WAY_STARTED_AT = "on_the_way_started_at"
    // Last winner-of-the-month announcement the courier has already dismissed,
    // so the congratulation dialog is not shown again on every app launch.
    const val PREF_LAST_SEEN_WINNER_ANNOUNCEMENT_ID = "last_seen_winner_announcement_id"

    // Notification
    const val TRACKING_NOTIFICATION_ID = 1001
    const val SERVICE_NOTIFICATION_ID = 1002
    const val SHIFT_TRACKING_NOTIFICATION_ID = 1003

    // WorkManager
    const val SYNC_WORK_NAME = "route_sync_work"
    const val LOCATION_WORK_NAME = "location_work"
    const val OPERATION_SYNC_WORK_NAME = "operation_sync_work"

    // Maximum number of deliveries a courier can have IN_PROGRESS at once.
    // One is "current" (meter running); the others are paused.
    const val MAX_CONCURRENT_DELIVERIES = 2
}
