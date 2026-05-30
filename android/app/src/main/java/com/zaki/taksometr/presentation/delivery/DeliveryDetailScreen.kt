package com.zaki.taksometr.presentation.delivery

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.*
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.util.LocationUtils
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeliveryDetailScreen(
    deliveryId: String,
    onBack: () -> Unit,
    viewModel: DeliveryCompleteViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(deliveryId) {
        viewModel.loadDelivery(deliveryId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Детали доставки") },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else {
                state.delivery?.let { delivery ->
                    // Map
                    if (delivery.route.isNotEmpty()) {
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(250.dp),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            val center = delivery.route[delivery.route.size / 2]
                            val cameraPositionState = rememberCameraPositionState {
                                position = CameraPosition.fromLatLngZoom(
                                    LatLng(center.latitude, center.longitude), 14f
                                )
                            }

                            GoogleMap(
                                modifier = Modifier.fillMaxSize(),
                                cameraPositionState = cameraPositionState,
                                uiSettings = MapUiSettings(zoomControlsEnabled = true)
                            ) {
                                Polyline(
                                    points = delivery.route.map { LatLng(it.latitude, it.longitude) },
                                    color = Primary,
                                    width = 6f
                                )
                                // Start marker
                                delivery.route.firstOrNull()?.let {
                                    Marker(
                                        state = MarkerState(position = LatLng(it.latitude, it.longitude)),
                                        title = "Начало"
                                    )
                                }
                                // End marker
                                delivery.route.lastOrNull()?.let {
                                    Marker(
                                        state = MarkerState(position = LatLng(it.latitude, it.longitude)),
                                        title = "Конец"
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))
                    }

                    // Details card
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(20.dp)
                        ) {
                            DetailRow(
                                icon = Icons.Default.Phone,
                                label = "Клиент",
                                value = delivery.clientPhone
                            )
                            Divider(modifier = Modifier.padding(vertical = 12.dp))
                            DetailRow(
                                icon = Icons.Default.Route,
                                label = "Расстояние",
                                value = LocationUtils.formatDistance(delivery.distanceMeters)
                            )
                            Divider(modifier = Modifier.padding(vertical = 12.dp))
                            DetailRow(
                                icon = Icons.Default.Timer,
                                label = "Время поездки",
                                value = delivery.endTime?.let {
                                    LocationUtils.formatDuration(it - delivery.startTime)
                                } ?: "—"
                            )
                            Divider(modifier = Modifier.padding(vertical = 12.dp))
                            DetailRow(
                                icon = Icons.Default.CalendarToday,
                                label = "Дата",
                                value = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
                                    .format(Date(delivery.createdAt))
                            )
                            Divider(modifier = Modifier.padding(vertical = 12.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.Default.AttachMoney,
                                    contentDescription = null,
                                    tint = AccentGreen,
                                    modifier = Modifier.size(24.dp)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Column {
                                    Text(
                                        text = "Стоимость",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                    )
                                    Text(
                                        text = LocationUtils.formatCost(delivery.cost),
                                        style = MaterialTheme.typography.headlineSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = AccentGreen
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
