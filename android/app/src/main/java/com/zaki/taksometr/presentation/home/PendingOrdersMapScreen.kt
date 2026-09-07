package com.zaki.taksometr.presentation.home

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.presentation.components.SwipeToAcceptButton
import com.zaki.taksometr.presentation.theme.AccentBlue
import com.zaki.taksometr.presentation.theme.AccentGreen
import java.util.Locale
import kotlin.math.ceil

private data class TravelEstimate(val minutes: Int, val distanceKm: Double) {
    fun label(): String = "≈ $minutes мин • ${String.format(Locale.getDefault(), "%.1f", distanceKm)} км"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PendingOrdersMapScreen(
    onBack: () -> Unit,
    onOrderAccepted: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val hasLocationPermission = remember {
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
    }

    val orders = state.pendingMarketplaceOrders
    val courierPoint = state.currentCourierLocation
    val courierLatLng = courierPoint?.let { LatLng(it.latitude, it.longitude) }
    val mapOrders = orders.filter { it.pickupLat != null && it.pickupLng != null }

    var selectedOrderId by remember { mutableStateOf<String?>(null) }
    val selectedOrder = orders.firstOrNull { it.id == selectedOrderId }
    val selectedIndex = orders.indexOfFirst { it.id == selectedOrderId }

    LaunchedEffect(orders.map { it.id }) {
        if (orders.none { it.id == selectedOrderId }) {
            selectedOrderId = orders.minByOrNull { order ->
                distanceMeters(courierPoint, order) ?: Double.MAX_VALUE
            }?.id
        }
    }

    LaunchedEffect(hasLocationPermission) {
        if (hasLocationPermission) {
            viewModel.refreshCourierLocation()
            viewModel.startMapLocationUpdates()
        }
    }
    DisposableEffect(Unit) {
        onDispose { viewModel.stopMapLocationUpdates() }
    }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }
    LaunchedEffect(state.refreshError) {
        state.refreshError?.let { error ->
            snackbarHostState.showSnackbar(
                if (error == HomeRefreshError.NO_INTERNET) {
                    "Нет подключения к интернету"
                } else {
                    "Не удалось обновить заказы"
                }
            )
            viewModel.consumeRefreshError()
        }
    }
    LaunchedEffect(state.recentlyAcceptedMarketplaceOrderId) {
        if (state.recentlyAcceptedMarketplaceOrderId != null) {
            viewModel.consumeAcceptedMarketplaceOrder()
            onOrderAccepted()
        }
    }

    val fallbackLocation = LatLng(38.5598, 68.7870)
    val initialLocation = courierLatLng
        ?: mapOrders.firstOrNull()?.let { LatLng(it.pickupLat!!, it.pickupLng!!) }
        ?: fallbackLocation
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(initialLocation, 13f)
    }

    var lastFramedSignature by remember { mutableStateOf("") }
    val frameSignature = remember(courierLatLng, mapOrders) {
        buildString {
            append("courier:").append(courierLatLng != null)
            mapOrders.forEach { append('|').append(it.id) }
        }
    }
    LaunchedEffect(frameSignature) {
        if (frameSignature.isBlank() || frameSignature == lastFramedSignature) return@LaunchedEffect
        val points = buildList {
            courierLatLng?.let(::add)
            mapOrders.forEach { add(LatLng(it.pickupLat!!, it.pickupLng!!)) }
        }
        try {
            when {
                points.size > 1 -> {
                    val bounds = LatLngBounds.builder().also { builder ->
                        points.forEach(builder::include)
                    }.build()
                    cameraPositionState.animate(CameraUpdateFactory.newLatLngBounds(bounds, 140))
                }
                points.size == 1 -> cameraPositionState.animate(
                    CameraUpdateFactory.newLatLngZoom(points.first(), 15f)
                )
            }
            lastFramedSignature = frameSignature
        } catch (_: Exception) {
            points.firstOrNull()?.let {
                cameraPositionState.move(CameraUpdateFactory.newLatLngZoom(it, 14f))
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Карта заказов", fontWeight = FontWeight.Bold)
                        Text(
                            text = "${orders.size} ${orderWord(orders.size)} ожидает курьера",
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Назад")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    navigationIconContentColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            GoogleMap(
                modifier = Modifier.fillMaxSize(),
                cameraPositionState = cameraPositionState,
                properties = MapProperties(isMyLocationEnabled = hasLocationPermission),
                uiSettings = MapUiSettings(
                    zoomControlsEnabled = false,
                    myLocationButtonEnabled = false,
                    mapToolbarEnabled = false
                ),
                onMapClick = { selectedOrderId = null }
            ) {
                mapOrders.forEachIndexed { index, order ->
                    val point = LatLng(order.pickupLat!!, order.pickupLng!!)
                    val estimate = travelEstimate(courierPoint, order)
                    Marker(
                        state = MarkerState(position = point),
                        title = "Заказ ${index + 1}",
                        snippet = estimate?.label() ?: order.pickupAddress,
                        icon = BitmapDescriptorFactory.defaultMarker(
                            if (order.id == selectedOrderId) {
                                BitmapDescriptorFactory.HUE_ORANGE
                            } else {
                                BitmapDescriptorFactory.HUE_GREEN
                            }
                        ),
                        onClick = {
                            selectedOrderId = order.id
                            true
                        }
                    )
                }
            }

            Surface(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(12.dp),
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                shadowElevation = 6.dp
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .background(AccentGreen, CircleShape)
                    )
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(
                            text = if (orders.isEmpty()) "Свободных заказов нет" else "Заказы обновляются онлайн",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        val withoutCoordinates = orders.size - mapOrders.size
                        if (withoutCoordinates > 0) {
                            Text(
                                text = "$withoutCoordinates без точки на карте",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            Column(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                SmallFloatingActionButton(
                    onClick = viewModel::refreshHome,
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.primary
                ) {
                    if (state.isRefreshing) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить заказы")
                    }
                }
                courierLatLng?.let { current ->
                    SmallFloatingActionButton(
                        onClick = {
                            cameraPositionState.move(
                                CameraUpdateFactory.newLatLngZoom(current, 16f)
                            )
                        },
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    ) {
                        Icon(Icons.Default.MyLocation, contentDescription = "Моё местоположение")
                    }
                }
            }

            selectedOrder?.let { order ->
                PendingMapOrderCard(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(12.dp),
                    order = order,
                    estimate = travelEstimate(courierPoint, order),
                    orderNumber = selectedIndex + 1,
                    totalOrders = orders.size,
                    isAccepting = state.isAcceptingMarketplaceOrder,
                    onPrevious = {
                        if (orders.isNotEmpty()) {
                            selectedOrderId = orders[(selectedIndex - 1 + orders.size) % orders.size].id
                        }
                    },
                    onNext = {
                        if (orders.isNotEmpty()) {
                            selectedOrderId = orders[(selectedIndex + 1) % orders.size].id
                        }
                    },
                    onAccept = { viewModel.acceptPendingMarketplaceOrder(order.id) }
                )
            }
        }
    }
}

@Composable
private fun PendingMapOrderCard(
    modifier: Modifier,
    order: PendingMarketplaceOrder,
    estimate: TravelEstimate?,
    orderNumber: Int,
    totalOrders: Int,
    isAccepting: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onAccept: () -> Unit
) {
    val context = LocalContext.current
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 10.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = AccentGreen.copy(alpha = 0.14f)
                ) {
                    Icon(
                        Icons.Default.LocalShipping,
                        contentDescription = null,
                        tint = AccentGreen,
                        modifier = Modifier.padding(8.dp).size(22.dp)
                    )
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Свободный заказ", fontWeight = FontWeight.Bold)
                    Text(
                        text = estimate?.label() ?: "Расстояние уточняется",
                        style = MaterialTheme.typography.bodySmall,
                        color = AccentBlue,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                if (totalOrders > 1) {
                    IconButton(onClick = onPrevious) {
                        Icon(Icons.Default.ChevronLeft, contentDescription = "Предыдущий заказ")
                    }
                    Text(
                        "$orderNumber/$totalOrders",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(onClick = onNext) {
                        Icon(Icons.Default.ChevronRight, contentDescription = "Следующий заказ")
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, null, tint = AccentGreen, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text("Забрать", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = order.pickupAddress.ifBlank { "Точка забора на карте" },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (order.pickupLat != null && order.pickupLng != null) {
                    FilledTonalIconButton(
                        onClick = {
                            com.zaki.taksometr.util.IntentUtils.openNavigation(
                                context,
                                order.pickupLat,
                                order.pickupLng,
                                order.pickupAddress
                            )
                        }
                    ) {
                        Icon(Icons.Default.Navigation, contentDescription = "Построить маршрут")
                    }
                }
            }

            if (order.destinationAddress.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Flag, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text("Доставить", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            text = order.destinationAddress,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            SwipeToAcceptButton(isAccepting = isAccepting, onAccept = onAccept)
            Text(
                text = "Время и расстояние рассчитаны приблизительно до точки забора",
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
}

private fun distanceMeters(courier: GeoPoint?, order: PendingMarketplaceOrder): Double? {
    val pickupLat = order.pickupLat ?: return null
    val pickupLng = order.pickupLng ?: return null
    courier ?: return null
    val result = FloatArray(1)
    Location.distanceBetween(
        courier.latitude,
        courier.longitude,
        pickupLat,
        pickupLng,
        result
    )
    return result[0].toDouble()
}

private fun travelEstimate(courier: GeoPoint?, order: PendingMarketplaceOrder): TravelEstimate? {
    val straightDistance = distanceMeters(courier, order) ?: return null
    val estimatedRoadKm = straightDistance / 1000.0 * 1.25
    val estimatedMinutes = ceil(estimatedRoadKm / 28.0 * 60.0).toInt().coerceAtLeast(2)
    return TravelEstimate(estimatedMinutes, estimatedRoadKm)
}

private fun orderWord(count: Int): String {
    val mod100 = count % 100
    val mod10 = count % 10
    return when {
        mod100 in 11..14 -> "заказов"
        mod10 == 1 -> "заказ"
        mod10 in 2..4 -> "заказа"
        else -> "заказов"
    }
}
