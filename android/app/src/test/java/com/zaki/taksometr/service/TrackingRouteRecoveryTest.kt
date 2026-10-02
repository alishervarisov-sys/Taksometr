package com.zaki.taksometr.service

import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.util.LocationUtils
import org.junit.Assert.assertEquals
import org.junit.Test

class TrackingRouteRecoveryTest {
    @Test fun restoredRouteKeepsDistanceButDoesNotChargeTravelDuringInterruption() {
        val start = GeoPoint(38.0, 68.0)
        val beforeRestart = GeoPoint(38.001, 68.0)
        val restoredFix = GeoPoint(38.05, 68.0, isGap = true)
        val nextFix = GeoPoint(38.051, 68.0)
        val expected = LocationUtils.haversineDistance(start, beforeRestart) +
            LocationUtils.haversineDistance(restoredFix, nextFix)
        assertEquals(expected, LocationUtils.calculateTotalDistance(listOf(start, beforeRestart, restoredFix, nextFix)), 0.001)
    }

    @Test fun repeatedResumesNeverAddPausedOrderTravelToMeter() {
        val points = listOf(
            GeoPoint(38.0, 68.0), GeoPoint(38.001, 68.0),
            GeoPoint(38.05, 68.0, isGap = true), GeoPoint(38.051, 68.0),
            GeoPoint(38.1, 68.0, isGap = true), GeoPoint(38.101, 68.0)
        )
        val expected = LocationUtils.haversineDistance(points[0], points[1]) +
            LocationUtils.haversineDistance(points[2], points[3]) +
            LocationUtils.haversineDistance(points[4], points[5])
        assertEquals(expected, LocationUtils.calculateTotalDistance(points), 0.001)
    }
}
