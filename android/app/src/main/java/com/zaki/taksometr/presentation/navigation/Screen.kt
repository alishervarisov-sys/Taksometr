package com.zaki.taksometr.presentation.navigation

sealed class Screen(val route: String) {
    data object Auth : Screen("auth")
    data object Home : Screen("home")
    data object ActiveDelivery : Screen("active_delivery")
    data object DeliveryComplete : Screen("delivery_complete/{deliveryId}") {
        fun createRoute(deliveryId: String) = "delivery_complete/$deliveryId"
    }
    data object History : Screen("history")
    data object DeliveryDetail : Screen("delivery_detail/{deliveryId}") {
        fun createRoute(deliveryId: String) = "delivery_detail/$deliveryId"
    }
}
