package com.zaki.taksometr.presentation.delivery

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.*
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

    // Map state
    val defaultLocation = LatLng(41.2995, 69.2401) // Tashkent
    val currentLatLng = state.currentLocation?.let {
        LatLng(it.latitude, it.longitude)
    } ?: defaultLocation

    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(currentLatLng, 15f)
    }

    // Update camera when location changes
    LaunchedEffect(state.currentLocation) {
        state.currentLocation?.let {
            cameraPositionState.animate(
                CameraUpdateFactory.newLatLng(LatLng(it.latitude, it.longitude))
            )
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

                    // Current location marker
                    state.currentLocation?.let {
                        Marker(
                            state = MarkerState(position = LatLng(it.latitude, it.longitude)),
                            title = str(Strings.delivery)
                        )
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
                        .padding(16.dp)
                ) {
                    // Client phone - call button
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Button(
                            onClick = {
                                state.delivery?.clientPhone?.let { phone ->
                                    val intent = android.content.Intent(
                                        android.content.Intent.ACTION_DIAL,
                                        android.net.Uri.parse("tel:$phone")
                                    )
                                    context.startActivity(intent)
                                }
                            },
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
                                text = "озвонить клиенту",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }


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
                        if (state.delivery?.comment?.isNotBlank() == true) {
                            Text(text = "Комментарий: ${state.delivery?.comment}")
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { viewModel.updateMarketplaceStage(stage = "ARRIVED_PICKUP") }, modifier = Modifier.fillMaxWidth()) {
                                Text("Прибыл к забору")
                            }
                            Button(onClick = { viewModel.updateMarketplaceStage(stage = "PICKED_UP") }, modifier = Modifier.fillMaxWidth()) {
                                Text("Забрал")
                            }
                            Button(onClick = { viewModel.updateMarketplaceStage(stage = "ON_THE_WAY") }, modifier = Modifier.fillMaxWidth()) {
                                Text("Еду")
                            }
                            Button(onClick = { viewModel.updateMarketplaceStage(stage = "ARRIVED_DESTINATION") }, modifier = Modifier.fillMaxWidth()) {
                                Text("Прибыл клиенту")
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

                    // Waiting button
                    Button(
                        onClick = { viewModel.toggleWaiting() },
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
