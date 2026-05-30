package com.zaki.taksometr.presentation.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.zaki.taksometr.presentation.auth.LoginScreen
import com.zaki.taksometr.presentation.delivery.ActiveDeliveryScreen
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

        composable(Screen.ActiveDelivery.route) {
            ActiveDeliveryScreen(
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
