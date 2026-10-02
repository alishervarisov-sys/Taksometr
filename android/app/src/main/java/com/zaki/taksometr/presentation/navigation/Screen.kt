package com.zaki.taksometr.presentation.navigation

sealed class Screen(val route: String) {
    data object Auth : Screen("auth")
    data object AdminPanel : Screen("admin_panel")
    data object Home : Screen("home")
    data object PendingOrdersMap : Screen("pending_orders_map")
    data object ActiveDelivery : Screen("active_delivery")
    data object DeliveryComplete : Screen("delivery_complete/{deliveryId}") {
        fun createRoute(deliveryId: String) = "delivery_complete/$deliveryId"
    }
    data object Profile : Screen("profile")
    data object BalanceTopUp : Screen("profile/top-up")
    data object DailyStats : Screen("daily_stats")
    data object Operations : Screen("operations")
    data object CourierNotifications : Screen("courier_notifications")
    data object History : Screen("history")
    data object DeliveryDetail : Screen("delivery_detail/{deliveryId}") {
        fun createRoute(deliveryId: String) = "delivery_detail/$deliveryId"
    }
    data object DeliveryChain : Screen("delivery_chain")
}
