package com.zaki.taksometr.presentation.delivery

import androidx.compose.animation.animateContentSize
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.*
import com.zaki.taksometr.presentation.components.SwipeToAcceptButton
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.service.LocationTrackingService
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.str
import com.zaki.taksometr.util.Strings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActiveDeliveryScreen(
    onDeliveryComplete: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: ActiveDeliveryViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var showCancelDialog by remember { mutableStateOf(false) }
    var showCompleteDialog by remember { mutableStateOf(false) }
    // Whether the delivery info panel is expanded. Collapsing it gives the
    // courier a much larger map view while keeping the call button reachable.
    var infoPanelExpanded by remember { mutableStateOf(true) }

    // Map state
    val defaultLocation = LatLng(41.2995, 69.2401) // Tashkent

    // Pickup ("Откуда") point selected by the admin when the order was created.
    val pickupLatLng = run {
        val lat = state.delivery?.pickupLat
        val lng = state.delivery?.pickupLng
        if (lat != null && lng != null) LatLng(lat, lng) else null
    }
    // Destination ("Куда") point, if the order has one.
    val destinationLatLng = run {
        val lat = state.delivery?.destinationLat
        val lng = state.delivery?.destinationLng
        if (lat != null && lng != null) LatLng(lat, lng) else null
    }
    val courierLatLng = state.currentLocation?.let {
        LatLng(it.latitude, it.longitude)
    }

    // Center the map on the pickup ("Откуда") point first, so the courier
    // immediately sees where the order starts. Fall back to courier / default.
    val initialLatLng = pickupLatLng ?: courierLatLng ?: defaultLocation

    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(initialLatLng, 15f)
    }

    // One-time framing: once the pickup point is known, fit pickup, destination
    // and the courier into view instead of tracking only the courier.
    var hasFramedPickup by remember { mutableStateOf(false) }
    LaunchedEffect(pickupLatLng, courierLatLng, destinationLatLng) {
        if (pickupLatLng != null && !hasFramedPickup) {
            val points = listOfNotNull(pickupLatLng, destinationLatLng, courierLatLng)
            try {
                if (points.size >= 2) {
                    val boundsBuilder = LatLngBounds.builder()
                    points.forEach { boundsBuilder.include(it) }
                    cameraPositionState.animate(
                        CameraUpdateFactory.newLatLngBounds(boundsBuilder.build(), 140)
                    )
                } else {
                    cameraPositionState.animate(
                        CameraUpdateFactory.newLatLngZoom(pickupLatLng, 15f)
                    )
                }
            } catch (e: Exception) {
                cameraPositionState.animate(CameraUpdateFactory.newLatLng(pickupLatLng))
            }
            hasFramedPickup = true
        }
    }

    // For orders without a pickup point (regular meter rides) keep following
    // the courier's live location as before.
    LaunchedEffect(state.currentLocation) {
        if (pickupLatLng == null) {
            state.currentLocation?.let {
                cameraPositionState.animate(
                    CameraUpdateFactory.newLatLng(LatLng(it.latitude, it.longitude))
                )
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(str(Strings.delivery)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Map
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                GoogleMap(
                    modifier = Modifier.fillMaxSize(),
                    cameraPositionState = cameraPositionState,
                    properties = MapProperties(isMyLocationEnabled = true),
                    uiSettings = MapUiSettings(zoomControlsEnabled = false)
                ) {
                    // Draw route polyline
                    if (state.routePoints.size >= 2) {
                        Polyline(
                            points = state.routePoints.map { LatLng(it.latitude, it.longitude) },
                            color = Primary,
                            width = 8f
                        )
                    }

                    // Pickup ("Откуда") marker — where the admin order starts.
                    pickupLatLng?.let {
                        Marker(
                            state = MarkerState(position = it),
                            title = "Откуда",
                            snippet = state.delivery?.pickupAddress?.ifBlank { null },
                            icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_GREEN)
                        )
                    }

                    // Destination ("Куда") marker, if provided.
                    destinationLatLng?.let {
                        Marker(
                            state = MarkerState(position = it),
                            title = "Куда",
                            snippet = state.delivery?.destinationAddress?.ifBlank { null },
                            icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_RED)
                        )
                    }

                    // Courier's current location marker only when there is no
                    // dedicated pickup point (the blue my-location dot covers it).
                    if (pickupLatLng == null) {
                        state.currentLocation?.let {
                            Marker(
                                state = MarkerState(position = LatLng(it.latitude, it.longitude)),
                                title = str(Strings.delivery)
                            )
                        }
                    }
                }

                // On-map info card: route addresses + key metrics (distance,
                // cost, client phone). Stays visible even when the panel below
                // is collapsed, so the courier always sees the essentials.
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                    shadowElevation = 6.dp
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
                    ) {
                        val pickupText = state.delivery?.pickupAddress?.ifBlank { null }
                        val destText = state.delivery?.destinationAddress?.ifBlank { null }

                        if (pickupText != null) {
                            RoutePointRow(color = AccentGreen, label = "Откуда", value = pickupText)
                        }
                        if (destText != null) {
                            if (pickupText != null) Spacer(modifier = Modifier.height(6.dp))
                            RoutePointRow(color = AccentRed, label = "Куда", value = destText)
                        }
                        if (pickupText != null || destText != null) {
                            Divider(
                                modifier = Modifier.padding(vertical = 8.dp),
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            MapInfoItem(
                                icon = Icons.Default.Route,
                                value = LocationUtils.formatDistance(state.distanceMeters)
                            )
                            MapInfoItem(
                                icon = Icons.Default.AttachMoney,
                                value = LocationUtils.formatCost(state.currentCost)
                            )
                            MapInfoItem(
                                icon = Icons.Default.Phone,
                                value = state.delivery?.clientPhone?.ifBlank { "—" } ?: "—"
                            )
                        }
                    }
                }
            }

            // Paused order (the other active order) — tap to resume its meter.
            state.pausedDelivery?.let { paused ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp)
                        .padding(top = 12.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = AccentOrange.copy(alpha = 0.12f)),
                    border = BorderStroke(1.dp, AccentOrange)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.PauseCircle,
                            contentDescription = null,
                            tint = AccentOrange,
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${str(Strings.pausedOrder)} · ${str(Strings.onPause)}",
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Bold,
                                color = AccentOrange
                            )
                            if (paused.clientPhone.isNotBlank()) {
                                Text(
                                    text = paused.clientPhone,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                                )
                            }
                        }
                        Button(
                            onClick = { viewModel.switchTo(paused.id) },
                            enabled = !state.isSwitching,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = AccentOrange)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(str(Strings.resumeOrder))
                        }
                    }
                }
            }

            // New order offer — accept as a second (concurrent) order.
            if (state.canAcceptMore) {
                state.pendingOrder?.let { pending ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp)
                            .padding(top = 12.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1)),
                        border = BorderStroke(1.5.dp, Color(0xFFFFB300))
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.LocalShipping,
                                    contentDescription = null,
                                    tint = Color(0xFFE65100),
                                    modifier = Modifier.size(22.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = str(Strings.newOrderAvailable),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFFE65100)
                                )
                            }
                            if (pending.pickupAddress.isNotBlank()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(text = "Откуда: ${pending.pickupAddress}", style = MaterialTheme.typography.bodySmall)
                            }
                            if (pending.destinationAddress.isNotBlank()) {
                                Text(text = "Куда: ${pending.destinationAddress}", style = MaterialTheme.typography.bodySmall)
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = str(Strings.secondOrderHint),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            SwipeToAcceptButton(
                                isAccepting = state.isAcceptingOrder,
                                onAccept = { viewModel.acceptPendingOrder(pending.id) },
                                accentColor = Color(0xFFE65100),
                                onAccentColor = Color.White
                            )
                        }
                    }
                }
            }

            // Info panel
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                shape = RoundedCornerShape(16.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .animateContentSize()
                        .padding(16.dp)
                ) {
                    // Collapsible header — toggles the detailed panel so the
                    // courier can see more of the map.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Информация о доставке",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        IconButton(onClick = { infoPanelExpanded = !infoPanelExpanded }) {
                            Icon(
                                if (infoPanelExpanded) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                                contentDescription = if (infoPanelExpanded) "Свернуть" else "Развернуть"
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Client phone - call button + external navigation buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                state.delivery?.clientPhone?.let { phone ->
                                    com.zaki.taksometr.util.IntentUtils.dialPhone(context, phone)
                                }
                            },
                            modifier = Modifier.weight(1f),
                            enabled = state.delivery?.clientPhone?.isNotBlank() == true,
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Icon(
                                Icons.Default.Phone,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Позвонить клиенту",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }

                        // Navigate to pickup ("Откуда") point when the order has one.
                        if (pickupLatLng != null || state.delivery?.pickupAddress?.isNotBlank() == true) {
                            FilledTonalIconButton(
                                onClick = {
                                    com.zaki.taksometr.util.IntentUtils.openNavigation(
                                        context,
                                        state.delivery?.pickupLat,
                                        state.delivery?.pickupLng,
                                        state.delivery?.pickupAddress ?: ""
                                    )
                                },
                                colors = IconButtonDefaults.filledTonalIconButtonColors(
                                    containerColor = AccentGreen.copy(alpha = 0.15f),
                                    contentColor = AccentGreen
                                )
                            ) {
                                Icon(Icons.Default.Navigation, contentDescription = "Маршрут к точке забора")
                            }
                        }

                        // Navigate to destination ("Куда") point when present.
                        if (destinationLatLng != null || state.delivery?.destinationAddress?.isNotBlank() == true) {
                            FilledTonalIconButton(
                                onClick = {
                                    com.zaki.taksometr.util.IntentUtils.openNavigation(
                                        context,
                                        state.delivery?.destinationLat,
                                        state.delivery?.destinationLng,
                                        state.delivery?.destinationAddress ?: ""
                                    )
                                },
                                colors = IconButtonDefaults.filledTonalIconButtonColors(
                                    containerColor = AccentRed.copy(alpha = 0.15f),
                                    contentColor = AccentRed
                                )
                            ) {
                                Icon(Icons.Default.Navigation, contentDescription = "Маршрут к клиенту")
                            }
                        }
                    }

                  if (infoPanelExpanded) {

                    if (state.delivery?.orderKind == "MARKETPLACE") {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Админ заказ",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        if (state.delivery?.pickupAddress?.isNotBlank() == true) {
                            Text(text = "Откуда: ${state.delivery?.pickupAddress}")
                        }
                        if (state.delivery?.destinationAddress?.isNotBlank() == true) {
                            Text(text = "Куда: ${state.delivery?.destinationAddress}")
                        }

                        // Highlighted comment
                        if (state.delivery?.comment?.isNotBlank() == true) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                colors = CardDefaults.cardColors(
                                    containerColor = AccentOrange.copy(alpha = 0.12f)
                                ),
                                border = BorderStroke(1.5.dp, AccentOrange)
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.Warning,
                                        contentDescription = null,
                                        tint = AccentOrange,
                                        modifier = Modifier.size(22.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Text(
                                        text = state.delivery?.comment ?: "",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = AccentOrange
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(10.dp))

                        // Current stage chip
                        val currentStage = state.delivery?.adminOrderStage
                        val currentStageLabel = when (currentStage) {
                            "ACCEPTED"            -> "Принят"
                            "ARRIVED_PICKUP"      -> "У точки забора"
                            "PICKED_UP"           -> "Товар забран"
                            "ON_THE_WAY"          -> "В пути к клиенту"
                            "ARRIVED_DESTINATION" -> "У клиента"
                            "COMPLETED"           -> "Завершён"
                            else                  -> "Принят"
                        }
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                        ) {
                            Text(
                                text = "Этап: $currentStageLabel",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Single next-stage button
                        val nextStageInfo: Pair<String, String>? = when (currentStage) {
                            null, "ACCEPTED"      -> Pair("ARRIVED_PICKUP",      "Прибыл к забору")
                            "ARRIVED_PICKUP"      -> Pair("PICKED_UP",           "Забрал товар")
                            "PICKED_UP"           -> Pair("ON_THE_WAY",          "Еду к клиенту")
                            "ON_THE_WAY"          -> Pair("ARRIVED_DESTINATION", "Прибыл к клиенту")
                            else                  -> null
                        }
                        if (nextStageInfo != null) {
                            // The first transition (→ ARRIVED_PICKUP) is gated: the
                            // courier must be within 150m of the admin-defined pickup
                            // point. Other transitions are never proximity-gated.
                            val requiresPickupProximity =
                                nextStageInfo.first == "ARRIVED_PICKUP" && pickupLatLng != null
                            val proximityBlocked =
                                requiresPickupProximity && !state.isWithinPickupRadius

                            Button(
                                onClick = { viewModel.updateMarketplaceStage(stage = nextStageInfo.first) },
                                enabled = !state.isUpdatingStage &&
                                        state.delivery?.isPaused != true &&
                                        !proximityBlocked,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                if (state.isUpdatingStage) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(18.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.onPrimary
                                    )
                                } else {
                                    Icon(
                                        if (proximityBlocked) Icons.Default.LocationOn else Icons.Default.ArrowForward,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = nextStageInfo.second,
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                }
                            }

                            // Hint shown while the courier is still too far from the
                            // pickup point to change the status.
                            if (proximityBlocked) {
                                Spacer(modifier = Modifier.height(6.dp))
                                val distanceHint = state.distanceToPickupMeters?.let {
                                    " (${LocationUtils.formatDistance(it)} до точки)"
                                } ?: ""
                                Row(
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.Info,
                                        contentDescription = null,
                                        tint = AccentOrange,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "Подъедьте к точке забора в радиусе 150 м, чтобы изменить статус$distanceHint",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = AccentOrange
                                    )
                                }
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        DeliveryStatItem(
                            icon = Icons.Default.Route,
                            label = str(Strings.distance),
                            value = LocationUtils.formatDistance(state.distanceMeters)
                        )
                        DeliveryStatItem(
                            icon = Icons.Default.Timer,
                            label = str(Strings.time),
                            value = LocationUtils.formatDuration(state.elapsedTime)
                        )
                        DeliveryStatItem(
                            icon = Icons.Default.AttachMoney,
                            label = str(Strings.cost),
                            value = LocationUtils.formatCost(state.currentCost)
                        )
                    }

                    // Waiting time display
                    if (state.totalWaitingMs > 0 || state.isWaiting) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.HourglassBottom,
                                contentDescription = null,
                                tint = if (state.isWaiting) AccentRed else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "${str(Strings.waiting)}: ${LocationUtils.formatDuration(state.totalWaitingMs)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (state.isWaiting) AccentRed else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    val isPaused = state.delivery?.isPaused == true

                    // Waiting button (disabled while the order is paused)
                    Button(
                        onClick = { viewModel.toggleWaiting() },
                        enabled = !isPaused,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (state.isWaiting)
                                AccentRed
                            else
                                MaterialTheme.colorScheme.secondary
                        )
                    ) {
                        Icon(
                            if (state.isWaiting) Icons.Default.StopCircle else Icons.Default.HourglassBottom,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (state.isWaiting) str(Strings.stopWaiting) else str(Strings.startWaiting),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // Pause / Resume the current order's meter
                    if (isPaused) {
                        Button(
                            onClick = { viewModel.resumeCurrent() },
                            enabled = !state.isSwitching,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = AccentGreen)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(str(Strings.resumeOrder), style = MaterialTheme.typography.bodyMedium)
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.PauseCircle,
                                contentDescription = null,
                                tint = AccentOrange,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = str(Strings.pausedNote),
                                style = MaterialTheme.typography.bodySmall,
                                color = AccentOrange
                            )
                        }
                    } else {
                        OutlinedButton(
                            onClick = { viewModel.pauseCurrent() },
                            enabled = !state.isSwitching,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentOrange)
                        ) {
                            Icon(Icons.Default.PauseCircle, contentDescription = null, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(str(Strings.pauseOrder), style = MaterialTheme.typography.bodyMedium)
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                                        // Status indicator
                    state.delivery?.let { delivery ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            val isInProgress = delivery.status.name == "IN_PROGRESS"
                            val statusColor = if (isInProgress) AccentGreen else AccentRed
                            val statusText = if (isInProgress) str(Strings.inProgress) else "${str(Strings.status)}: ${delivery.status.name}"

                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = statusColor.copy(alpha = 0.15f)
                            ) {
                                Text(
                                    text = statusText,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = statusColor,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    // Action buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = { showCancelDialog = true },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = AccentRed
                            )
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null)
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(str(Strings.cancel))
                        }

                        Button(
                            onClick = { showCompleteDialog = true },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            enabled = !state.isCompleting && state.delivery?.status?.name == "IN_PROGRESS",
                            colors = ButtonDefaults.buttonColors(
                                containerColor = AccentGreen
                            )
                        ) {
                            if (state.isCompleting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                            } else {
                                Icon(Icons.Default.Check, contentDescription = null)
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(str(Strings.complete))
                            }
                        }
                    }

                    // Warning if not in progress
                    if (state.delivery?.status?.name != "IN_PROGRESS") {
                        Spacer(modifier = Modifier.height(8.dp))
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = AccentRed.copy(alpha = 0.1f)
                        ) {
                            Text(
                                text = "Доставка не в статусе 'В процессе'. Кнопка 'Завершить' недоступна. Текущий статус: ${state.delivery?.status?.name ?: "null"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = AccentRed,
                                modifier = Modifier.padding(8.dp)
                            )
                        }
                    }

                    // Error
                    state.error?.let { error ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = error,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                  } // end infoPanelExpanded
                }
            }
        }
    }

    // Cancel dialog
    if (showCancelDialog) {
        AlertDialog(
            onDismissRequest = { showCancelDialog = false },
            title = { Text(str(Strings.cancelDelivery)) },
            text = { Text(str(Strings.confirmCancel)) },
            confirmButton = {
                Button(
                    onClick = {
                        showCancelDialog = false
                        LocationTrackingService.stopService(context)
                        viewModel.cancelDelivery { onBack() }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AccentRed)
                ) {
                    Text(str(Strings.cancelDelivery))
                }
            },
            dismissButton = {
                TextButton(onClick = { showCancelDialog = false }) {
                    Text(str(Strings.no))
                }
            }
        )
    }

    // Complete dialog
    if (showCompleteDialog) {
        AlertDialog(
            onDismissRequest = { showCompleteDialog = false },
            title = { Text("${str(Strings.complete)}?") },
            text = {
                Text(
                    "${str(Strings.distance)}: ${LocationUtils.formatDistance(state.distanceMeters)}\n" +
                    "${str(Strings.cost)}: ${LocationUtils.formatCost(state.currentCost)}"
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showCompleteDialog = false
                        LocationTrackingService.stopService(context)
                        viewModel.completeDelivery { deliveryId ->
                            onDeliveryComplete(deliveryId)
                        }
                    }
                ) {
                    Text(str(Strings.complete))
                }
            },
            dismissButton = {
                TextButton(onClick = { showCompleteDialog = false }) {
                    Text(str(Strings.no))
                }
            }
        )
    }
}

@Composable
fun RoutePointRow(
    color: Color,
    label: String,
    value: String
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = "$label:",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
fun MapInfoItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(18.dp)
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun DeliveryStatItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
    }
}
