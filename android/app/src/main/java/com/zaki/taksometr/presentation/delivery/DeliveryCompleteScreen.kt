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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.*
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.str
import com.zaki.taksometr.util.Strings
import com.zaki.taksometr.util.Resource
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun DeliveryCompleteScreen(
    deliveryId: String,
    onDone: () -> Unit,
    viewModel: DeliveryCompleteViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(deliveryId) {
        viewModel.loadDelivery(deliveryId)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        // Success icon
        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            tint = AccentGreen,
            modifier = Modifier.size(72.dp)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = str(Strings.deliveryCompleted),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(24.dp))

        state.delivery?.let { delivery ->
            // Delivery details card
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
                        label = str(Strings.client),
                        value = delivery.clientPhone
                    )
                    Divider(modifier = Modifier.padding(vertical = 12.dp))
                    DetailRow(
                        icon = Icons.Default.Route,
                        label = str(Strings.distance),
                        value = LocationUtils.formatDistance(delivery.distanceMeters)
                    )
                    Divider(modifier = Modifier.padding(vertical = 12.dp))
                    DetailRow(
                        icon = Icons.Default.Timer,
                        label = "${str(Strings.time)}",
                        value = delivery.endTime?.let {
                            LocationUtils.formatDuration(it - delivery.startTime)
                        } ?: "—"
                    )
                    Divider(modifier = Modifier.padding(vertical = 12.dp))
                    DetailRow(
                        icon = Icons.Default.CalendarToday,
                        label = "${str(Strings.time)}",
                        value = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
                            .format(Date(delivery.createdAt))
                    )
                    Divider(modifier = Modifier.padding(vertical = 12.dp))

                    // Cost - highlighted
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
                                text = str(Strings.totalCost),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                            Text(
                                text = LocationUtils.formatCost(delivery.cost),
                                style = MaterialTheme.typography.headlineMedium,
                                fontWeight = FontWeight.Bold,
                                color = AccentGreen
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Route map preview
            if (delivery.route.isNotEmpty()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp),
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
                        uiSettings = MapUiSettings(
                            zoomControlsEnabled = false,
                            scrollGesturesEnabled = false
                        )
                    ) {
                        Polyline(
                            points = delivery.route.map { LatLng(it.latitude, it.longitude) },
                            color = Primary,
                            width = 6f
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        Button(
            onClick = onDone,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(
                text = str(Strings.done),
                style = MaterialTheme.typography.titleMedium
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
fun DetailRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium
            )
        }
    }
}
