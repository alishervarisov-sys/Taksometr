package com.zaki.taksometr.util

import com.zaki.taksometr.domain.model.GeoPoint
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PickupArrivalPolicyTest {
    private val now = 100_000L
    private val pickup = GeoPoint(38.0, 68.0)

    @Test fun stationaryFixCanConfirmArrivalWithoutAddingMeterDistance() {
        val previous = pickup.copy(timestamp = now - 3_000L, accuracy = 10f)
        val current = pickup.copy(timestamp = now, accuracy = 10f)
        assertFalse(LocationUtils.isValidPoint(current, previous, previous.timestamp))
        assertTrue(PickupArrivalPolicy.isWithinRadius(current, pickup, now))
    }

    @Test fun nearbyFixWithModerateAccuracyCanConfirmArrivalEvenWhenMeterRejectsIt() {
        // About 56 m from pickup with a 60 m uncertainty circle: safely inside 200 m.
        val current = GeoPoint(38.0005, 68.0, timestamp = now, accuracy = 60f)
        assertFalse(LocationUtils.isValidPoint(current, null, null))
        assertTrue(PickupArrivalPolicy.isWithinRadius(current, pickup, now))
    }

    @Test fun staleCachedFixAndFutureFixCannotConfirmArrival() {
        assertFalse(PickupArrivalPolicy.isWithinRadius(pickup.copy(timestamp = now - 30_001), pickup, now))
        assertFalse(PickupArrivalPolicy.isWithinRadius(pickup.copy(timestamp = now + 1), pickup, now))
        assertTrue(PickupArrivalPolicy.isWithinRadius(pickup.copy(timestamp = now - 30_000), pickup, now))
    }

    @Test fun inaccurateOrMissingAccuracyCannotConfirmArrival() {
        for (accuracy in listOf(101f, Float.POSITIVE_INFINITY, Float.NaN, -1f)) {
            assertFalse(PickupArrivalPolicy.isWithinRadius(pickup.copy(timestamp = now, accuracy = accuracy), pickup, now))
        }
    }

    @Test fun uncertaintyOverlappingBoundaryWaitsForBetterFix() {
        val nearBoundary = GeoPoint(38.0017, 68.0, timestamp = now, accuracy = 30f)
        assertTrue(LocationUtils.haversineDistance(nearBoundary, pickup) < 200)
        assertFalse(PickupArrivalPolicy.isWithinRadius(nearBoundary, pickup, now))
        assertTrue(PickupArrivalPolicy.isWithinRadius(nearBoundary.copy(accuracy = 5f), pickup, now))
    }

    @Test fun outsideRadiusDoesNotConfirmArrival() {
        assertFalse(PickupArrivalPolicy.isWithinRadius(GeoPoint(38.003, 68.0, timestamp = now, accuracy = 5f), pickup, now))
    }

    @Test fun invalidCoordinatesCannotConfirmArrival() {
        assertFalse(PickupArrivalPolicy.isWithinRadius(pickup.copy(latitude = Double.NaN, timestamp = now), pickup, now))
        assertFalse(PickupArrivalPolicy.isWithinRadius(pickup.copy(timestamp = now), pickup.copy(longitude = 181.0), now))
    }
}
