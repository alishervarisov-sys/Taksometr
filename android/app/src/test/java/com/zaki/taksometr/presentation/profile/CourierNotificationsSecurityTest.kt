package com.zaki.taksometr.presentation.profile

import org.junit.Assert.assertEquals
import org.junit.Test

class CourierNotificationsSecurityTest {
    @Test
    fun hidesDeliveryIdForUnacceptedMarketplaceOrder() {
        assertEquals("", visibleDeliveryId("ADMIN_MARKETPLACE_ORDER", "order-secret-id"))
    }

    @Test
    fun keepsDeliveryIdForCourierOwnedNotification() {
        assertEquals(
            "accepted-order-id",
            visibleDeliveryId("ADMIN_DELIVERY_CANCELLED", "accepted-order-id")
        )
    }
}
