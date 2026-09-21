package com.zaki.taksometr.presentation.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.zaki.taksometr.presentation.theme.CourierBlue
import com.zaki.taksometr.presentation.theme.CourierBlueSoft
import com.zaki.taksometr.presentation.theme.CourierMuted
import com.zaki.taksometr.presentation.theme.CourierSurface
import com.zaki.taksometr.util.Strings
import com.zaki.taksometr.util.str

@Composable
fun CourierBottomBar(
    selected: CourierTab,
    onHome: () -> Unit,
    onOrders: () -> Unit,
    onProfile: () -> Unit
) {
    val colors = NavigationBarItemDefaults.colors(
        selectedIconColor = CourierBlue,
        selectedTextColor = CourierBlue,
        indicatorColor = CourierBlueSoft,
        unselectedIconColor = CourierMuted,
        unselectedTextColor = CourierMuted
    )
    NavigationBar(containerColor = CourierSurface) {
        NavigationBarItem(
            selected = selected == CourierTab.HOME,
            onClick = onHome,
            icon = { Icon(Icons.Default.Home, contentDescription = null) },
            label = { Text(str(Strings.homeTab)) },
            colors = colors
        )
        NavigationBarItem(
            selected = selected == CourierTab.ORDERS,
            onClick = onOrders,
            icon = { Icon(Icons.Default.ListAlt, contentDescription = null) },
            label = { Text(str(Strings.ordersTab)) },
            colors = colors
        )
        NavigationBarItem(
            selected = selected == CourierTab.PROFILE,
            onClick = onProfile,
            icon = { Icon(Icons.Default.Person, contentDescription = null) },
            label = { Text(str(Strings.profile)) },
            colors = colors
        )
    }
}

enum class CourierTab { HOME, ORDERS, PROFILE }
