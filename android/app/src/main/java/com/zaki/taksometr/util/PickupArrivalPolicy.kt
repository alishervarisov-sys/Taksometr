package com.zaki.taksometr.util

import com.zaki.taksometr.domain.model.GeoPoint

/** Arrival uses live fixes; the meter's 20 m accuracy/5 m movement filter is separate. */
object PickupArrivalPolicy {
    const val MAX_FIX_AGE_MS = 30_000L
    const val MAX_ACCURACY_METERS = 100f

    fun isFresh(point: GeoPoint, now: Long = System.currentTimeMillis()): Boolean =
        now - point.timestamp in 0..MAX_FIX_AGE_MS

    fun hasUsableAccuracy(point: GeoPoint): Boolean =
        point.latitude.isFinite() && point.latitude in -90.0..90.0 &&
            point.longitude.isFinite() && point.longitude in -180.0..180.0 &&
            point.accuracy.isFinite() && point.accuracy in 0f..MAX_ACCURACY_METERS

    fun isWithinRadius(point: GeoPoint, pickup: GeoPoint, now: Long = System.currentTimeMillis()): Boolean {
        if (!isFresh(point, now) || !hasUsableAccuracy(point)) return false
        if (!pickup.latitude.isFinite() || pickup.latitude !in -90.0..90.0 ||
            !pickup.longitude.isFinite() || pickup.longitude !in -180.0..180.0) return false
        // Require the reported uncertainty circle to fit inside the pickup radius.
        return LocationUtils.haversineDistance(point, pickup) + point.accuracy <=
            Constants.PICKUP_ARRIVAL_RADIUS_METERS
    }
}
