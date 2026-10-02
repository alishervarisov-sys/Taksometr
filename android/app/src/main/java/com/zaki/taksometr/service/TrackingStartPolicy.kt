package com.zaki.taksometr.service

enum class TrackingKind { DELIVERY, SHIFT }

enum class TrackingStartSource { VISIBLE_APP, BOOT, SYSTEM_RESTART, PUSH }

enum class TrackingStartDecision { START, NOT_NEEDED, NEED_LOCATION, NEED_GPS, WAIT_FOR_APP }

/** Both background-start eligibility and while-in-use access must be satisfied. */
object TrackingStartPolicy {
    fun decide(
        needed: Boolean,
        hasLocation: Boolean,
        gpsEnabled: Boolean,
        activityResumed: Boolean,
        hasBackgroundLocation: Boolean,
        sdk: Int,
        source: TrackingStartSource
    ): TrackingStartDecision = when {
        !needed -> TrackingStartDecision.NOT_NEEDED
        !hasLocation -> TrackingStartDecision.NEED_LOCATION
        !gpsEnabled -> TrackingStartDecision.NEED_GPS
        activityResumed -> TrackingStartDecision.START
        // Only the OS may perform a sticky restart; callers cannot use this exemption.
        source == TrackingStartSource.SYSTEM_RESTART -> TrackingStartDecision.START
        source == TrackingStartSource.BOOT && (sdk < 29 || hasBackgroundLocation) -> TrackingStartDecision.START
        else -> TrackingStartDecision.WAIT_FOR_APP
    }
}
