package com.zaki.taksometr.service

import org.junit.Assert.assertEquals
import org.junit.Test

class TrackingStartPolicyTest {
    private fun decide(
        source: TrackingStartSource = TrackingStartSource.VISIBLE_APP,
        visible: Boolean = false,
        location: Boolean = true,
        background: Boolean = false,
        gps: Boolean = true,
        needed: Boolean = true,
        sdk: Int = 34
    ) = TrackingStartPolicy.decide(needed, location, gps, visible, background, sdk, source)

    @Test fun visibleAppCanStartWithWhileInUsePermission() {
        assertEquals(TrackingStartDecision.START, decide(visible = true))
    }

    @Test fun asyncUiActionMustWaitIfActivityWasPaused() {
        assertEquals(TrackingStartDecision.WAIT_FOR_APP, decide())
    }

    @Test fun backgroundPermissionAloneDoesNotGrantBackgroundStartExemption() {
        assertEquals(TrackingStartDecision.WAIT_FOR_APP, decide(background = true))
    }

    @Test fun bootWithWhileInUsePermissionWaitsForAppOnModernAndroid() {
        for (sdk in listOf(29, 30, 31, 33, 34)) {
            assertEquals("API $sdk", TrackingStartDecision.WAIT_FOR_APP,
                decide(source = TrackingStartSource.BOOT, sdk = sdk))
        }
    }

    @Test fun bootWithBackgroundAccessCanRestoreBothTrackers() {
        assertEquals(TrackingStartDecision.START, decide(source = TrackingStartSource.BOOT, background = true))
    }

    @Test fun legacyBootDoesNotRequireNonexistentBackgroundPermission() {
        assertEquals(TrackingStartDecision.START, decide(source = TrackingStartSource.BOOT, sdk = 28))
    }

    @Test fun osStickyRestartRestoresWhileInUseTracking() {
        assertEquals(TrackingStartDecision.START, decide(source = TrackingStartSource.SYSTEM_RESTART))
    }

    @Test fun stoppedShiftOrMissingDeliveryNeverRestartsForAnySource() {
        for (source in TrackingStartSource.values()) {
            assertEquals(source.name, TrackingStartDecision.NOT_NEEDED, decide(source = source, needed = false))
        }
    }

    @Test fun revokedLocationDeniesEvenBootAndStickyExemptions() {
        for (source in TrackingStartSource.values()) {
            assertEquals(source.name, TrackingStartDecision.NEED_LOCATION,
                decide(source = source, location = false, background = true, visible = true))
        }
    }

    @Test fun gpsOffDoesNotReportTrackingAsStarted() {
        for (source in TrackingStartSource.values()) {
            assertEquals(source.name, TrackingStartDecision.NEED_GPS, decide(source = source, gps = false, visible = true))
        }
    }

    @Test fun pushCannotCreateTrackerFromBackgroundEvenWithBackgroundAccess() {
        assertEquals(TrackingStartDecision.WAIT_FOR_APP, decide(source = TrackingStartSource.PUSH, background = true))
    }
}
