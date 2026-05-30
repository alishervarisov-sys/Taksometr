package com.zaki.taksometr.util

import com.zaki.taksometr.domain.model.GeoPoint
import kotlin.math.*

object LocationUtils {

    private const val EARTH_RADIUS_METERS = 6371000.0
    private const val MIN_ACCURACY_METERS = 20f
    private const val MAX_SPEED_MPS = 50.0 // 180 km/h max reasonable speed
    private const val MIN_DISTANCE_METERS = 5.0

    /**
     * Calculate distance between two points using Haversine formula
     */
    fun haversineDistance(point1: GeoPoint, point2: GeoPoint): Double {
        val lat1 = Math.toRadians(point1.latitude)
        val lat2 = Math.toRadians(point2.latitude)
        val deltaLat = Math.toRadians(point2.latitude - point1.latitude)
        val deltaLon = Math.toRadians(point2.longitude - point1.longitude)

        val a = sin(deltaLat / 2).pow(2) +
                cos(lat1) * cos(lat2) * sin(deltaLon / 2).pow(2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))

        return EARTH_RADIUS_METERS * c
    }

    /**
     * Calculate total distance for a list of route points
     */
    fun calculateTotalDistance(points: List<GeoPoint>): Double {
        if (points.size < 2) return 0.0
        var totalDistance = 0.0
        for (i in 1 until points.size) {
            totalDistance += haversineDistance(points[i - 1], points[i])
        }
        return totalDistance
    }

    /**
     * Check if a GPS point is valid (not a jump, good accuracy)
     */
    fun isValidPoint(
        newPoint: GeoPoint,
        lastPoint: GeoPoint?,
        lastValidTimestamp: Long?
    ): Boolean {
        // Check accuracy
        if (newPoint.accuracy > MIN_ACCURACY_METERS) {
            return false
        }

        // If no previous point, accept this one
        if (lastPoint == null || lastValidTimestamp == null) {
            return true
        }

        // Calculate distance and time difference
        val distance = haversineDistance(lastPoint, newPoint)
        val timeDiff = (newPoint.timestamp - lastValidTimestamp) / 1000.0 // seconds

        // Ignore if too close (noise)
        if (distance < MIN_DISTANCE_METERS) {
            return false
        }

        // Check for GPS jump (unrealistic speed)
        if (timeDiff > 0) {
            val speed = distance / timeDiff // m/s
            if (speed > MAX_SPEED_MPS) {
                return false
            }
        }

        return true
    }

    /**
     * Format distance for display
     */
    fun formatDistance(meters: Double): String {
        return if (meters < 1000) {
            "${meters.toInt()} м"
        } else {
            String.format("%.1f км", meters / 1000)
        }
    }

    /**
     * Format duration for display
     */
    fun formatDuration(millis: Long): String {
        val seconds = millis / 1000
        val minutes = seconds / 60
        val hours = minutes / 60
        return when {
            hours > 0 -> String.format("%d:%02d:%02d", hours, minutes % 60, seconds % 60)
            else -> String.format("%d:%02d", minutes, seconds % 60)
        }
    }

    /**
     * Format cost for display
     */
    fun formatCost(cost: Double): String {
        return String.format("%,.0f сомони", cost)
    }
}
