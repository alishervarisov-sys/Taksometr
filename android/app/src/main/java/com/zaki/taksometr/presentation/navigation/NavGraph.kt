package com.zaki.taksometr.presentation.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.UserRole
import com.zaki.taksometr.presentation.admin.AdminPanelScreen
import com.zaki.taksometr.presentation.auth.LoginScreen
import com.zaki.taksometr.presentation.delivery.ActiveDeliveryScreen
import com.zaki.taksometr.presentation.delivery.FixedPriceDeliveryScreen
import com.zaki.taksometr.presentation.delivery.DeliveryCompleteScreen
import com.zaki.taksometr.presentation.delivery.DeliveryDetailScreen
import com.zaki.taksometr.presentation.history.HistoryScreen
import com.zaki.taksometr.presentation.home.HomeScreen
import com.zaki.taksometr.presentation.home.PendingOrdersMapScreen
import com.zaki.taksometr.presentation.profile.ProfileScreen
import com.zaki.taksometr.presentation.profile.DailyStatsScreen
import com.zaki.taksometr.presentation.profile.OperationsScreen
import com.zaki.taksometr.presentation.profile.CourierNotificationsScreen

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Auth.route) {
            LoginScreen(
                onLoginSuccess = { user ->
                    val destination = if (user.role == UserRole.ADMIN) {
                        Screen.AdminPanel.route
                    } else {
                        Screen.Home.route
                    }
                    navController.navigate(destination) {
                        popUpTo(Screen.Auth.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.AdminPanel.route) {
            AdminPanelScreen(
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.AdminPanel.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onStartDelivery = {
                    navController.navigate(Screen.ActiveDelivery.route)
                },
                onOrdersMapClick = {
                    navController.navigate(Screen.PendingOrdersMap.route)
                },
                onNotificationsClick = {
                    navController.navigate(Screen.CourierNotifications.route)
                },
                onProfileClick = {
                    navController.navigate(Screen.Profile.route)
                },
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.PendingOrdersMap.route) {
            PendingOrdersMapScreen(
                onBack = { navController.popBackStack() },
                onOrderAccepted = {
                    navController.navigate(Screen.ActiveDelivery.route) {
                        popUpTo(Screen.PendingOrdersMap.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Profile.route) {
            ProfileScreen(
                onBack = {
                    navController.popBackStack()
                },
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onHistoryClick = {
                    navController.navigate(Screen.History.route)
                },
                onDaysClick = {
                    navController.navigate(Screen.DailyStats.route)
                },
                onTransactionsClick = {
                    navController.navigate(Screen.Operations.route)
                },
                onNotificationsClick = {
                    navController.navigate(Screen.CourierNotifications.route)
                }
            )
        }

        composable(Screen.DailyStats.route) {
            DailyStatsScreen(onBack = { navController.popBackStack() })
        }

        composable(Screen.Operations.route) {
            OperationsScreen(
                onBack = { navController.popBackStack() },
                onDeliveryClick = { deliveryId ->
                    navController.navigate(Screen.DeliveryDetail.createRoute(deliveryId))
                }
            )
        }

        composable(Screen.CourierNotifications.route) {
            CourierNotificationsScreen(
                onBack = { navController.popBackStack() },
                onDeliveryClick = { deliveryId ->
                    navController.navigate(Screen.DeliveryDetail.createRoute(deliveryId))
                }
            )
        }

        // DeliveryChain route removed

        composable(Screen.ActiveDelivery.route) {
            ActiveDeliveryScreenRouter(
                onDeliveryComplete = { deliveryId ->
                    navController.navigate(Screen.DeliveryComplete.createRoute(deliveryId)) {
                        popUpTo(Screen.ActiveDelivery.route) { inclusive = true }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = Screen.DeliveryComplete.route,
            arguments = listOf(navArgument("deliveryId") { type = NavType.StringType })
        ) { backStackEntry ->
            val deliveryId = backStackEntry.arguments?.getString("deliveryId") ?: ""
            DeliveryCompleteScreen(
                deliveryId = deliveryId,
                onDone = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.History.route) {
            HistoryScreen(
                onDeliveryClick = { deliveryId ->
                    navController.navigate(Screen.DeliveryDetail.createRoute(deliveryId))
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = Screen.DeliveryDetail.route,
            arguments = listOf(navArgument("deliveryId") { type = NavType.StringType })
        ) { backStackEntry ->
            val deliveryId = backStackEntry.arguments?.getString("deliveryId") ?: ""
            DeliveryDetailScreen(
                deliveryId = deliveryId,
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}


@Composable
fun ActiveDeliveryScreenRouter(
    onDeliveryComplete: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: com.zaki.taksometr.presentation.delivery.ActiveDeliveryViewModel = androidx.hilt.navigation.compose.hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val delivery = state.delivery

    // Marketplace deliveries have their own operational flow: the courier
    // needs the map, pickup/destination details, item comment, and staged
    // handoff controls. A Motorol food order has a fixed delivery fee, but it
    // must still use that marketplace screen rather than the legacy fixed-price
    // completion screen.
    val useFixedScreen = delivery != null &&
        delivery.orderKind != "MARKETPLACE" &&
        delivery.deliveryType != "default" &&
        delivery.deliveryType != "heavyCargoMeter" &&
        delivery.status == DeliveryStatus.IN_PROGRESS

    if (useFixedScreen) {
        FixedPriceDeliveryScreen(
            onDeliveryComplete = onDeliveryComplete,
            onBack = { viewModel.stopWaitingBeforeExit(onBack) },
            viewModel = viewModel
        )
    } else {
        ActiveDeliveryScreen(
            onDeliveryComplete = onDeliveryComplete,
            onBack = { viewModel.stopWaitingBeforeExit(onBack) },
            viewModel = viewModel
        )
    }
}
