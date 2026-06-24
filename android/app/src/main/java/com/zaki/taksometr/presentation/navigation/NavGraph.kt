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
import com.zaki.taksometr.presentation.auth.LoginScreen
import com.zaki.taksometr.presentation.delivery.ActiveDeliveryScreen
import com.zaki.taksometr.presentation.delivery.FixedPriceDeliveryScreen
import com.zaki.taksometr.presentation.delivery.DeliveryCompleteScreen
import com.zaki.taksometr.presentation.delivery.DeliveryDetailScreen
import com.zaki.taksometr.presentation.history.HistoryScreen
import com.zaki.taksometr.presentation.home.HomeScreen

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
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Auth.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onStartDelivery = {
                    navController.navigate(Screen.ActiveDelivery.route)
                },
                onHistoryClick = {
                    navController.navigate(Screen.History.route)
                },
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
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
    val context = androidx.compose.ui.platform.LocalContext.current

    // Show toast for debugging
    androidx.compose.runtime.LaunchedEffect(delivery) {
        if (delivery != null) {
            android.widget.Toast.makeText(
                context,
                "Доставка: тип=${delivery.deliveryType}, статус=${delivery.status}, цена=${delivery.fixedPrice}",
                android.widget.Toast.LENGTH_LONG
            ).show()
        }
    }

    // Log for debugging
    android.util.Log.d("DeliveryRouter", "=== ROUTER DEBUG ===")
    android.util.Log.d("DeliveryRouter", "Delivery: $delivery")
    android.util.Log.d("DeliveryRouter", "DeliveryType: ${delivery?.deliveryType}")
    android.util.Log.d("DeliveryRouter", "Status: ${delivery?.status}")
    android.util.Log.d("DeliveryRouter", "FixedPrice: ${delivery?.fixedPrice}")
    android.util.Log.d("DeliveryRouter", "==================")

    val useFixedScreen = delivery != null &&
        delivery.deliveryType != "default" &&
        delivery.status != DeliveryStatus.IN_PROGRESS

    if (useFixedScreen) {
        // Fixed price delivery - show simple screen before delivery starts
        FixedPriceDeliveryScreen(
            onDeliveryComplete = onDeliveryComplete,
            onBack = onBack,
            viewModel = viewModel
        )
    } else {
        // Active/in-progress delivery - always show map and courier movement
        ActiveDeliveryScreen(
            onDeliveryComplete = onDeliveryComplete,
            onBack = onBack,
            viewModel = viewModel
        )
    }
}
