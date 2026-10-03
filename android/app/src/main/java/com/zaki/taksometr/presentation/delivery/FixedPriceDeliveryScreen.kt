package com.zaki.taksometr.presentation.delivery

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.str
import com.zaki.taksometr.util.Strings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FixedPriceDeliveryScreen(
    onDeliveryComplete: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: ActiveDeliveryViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var showCompleteDialog by rememberSaveable { mutableStateOf(false) }
    BackHandler(onBack = onBack)

    val delivery = state.delivery
    val deliveryTypeName = when (delivery?.deliveryType) {
        "coal" -> str(Strings.coal)
        "gas15" -> str(Strings.gas15)
        "gas30" -> str(Strings.gas30)
        "gas30plus" -> str(Strings.gas30plus)
        "errands" -> str(Strings.errands)
        "heavyCargo" -> str(Strings.heavyCargo)
        else -> str(Strings.delivery)
    }

    Scaffold(
        containerColor = CourierCanvas,

        topBar = {
            TopAppBar(
                title = { Text(str(Strings.delivery)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CourierSky,
                    titleContentColor = CourierInk,
                    navigationIconContentColor = CourierBlueDark
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Icon
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .clip(CircleShape)
                    .then(
                        Modifier
                            .padding(8.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    when (delivery?.deliveryType) {
                        "coal" -> Icons.Default.LocalShipping
                        "gas15", "gas30", "gas30plus" -> Icons.Default.LocalGasStation
                        "errands" -> Icons.Default.ShoppingBag
                        "heavyCargo" -> Icons.Default.FitnessCenter
                        else -> Icons.Default.DeliveryDining
                    },
                    contentDescription = null,
                    modifier = Modifier.size(80.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Delivery type
            Text(
                text = deliveryTypeName,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Fixed price
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = str(Strings.fixedPrice),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = LocationUtils.formatCost(delivery?.fixedPrice ?: 0.0),
                        style = MaterialTheme.typography.displayMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Timer
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Timer,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "${str(Strings.time)}: ${LocationUtils.formatDuration(state.elapsedTime)}",
                        style = MaterialTheme.typography.titleMedium
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Client phone - call button
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
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.secondary
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
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            Spacer(modifier = Modifier.weight(1f))

                        // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
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

    if (showCompleteDialog && state.delivery != null) {
        DeliveryCompletionDialog(
            delivery = state.delivery!!,
            summary = "${str(Strings.delivery)}: $deliveryTypeName\nСтоимость: ${LocationUtils.formatCost(delivery?.fixedPrice ?: 0.0)}",
            isCompleting = state.isCompleting,
            error = state.error,
            onDismiss = { showCompleteDialog = false },
            onConfirm = { code, photo ->
                viewModel.completeDelivery(code, photo) { deliveryId ->
                    showCompleteDialog = false
                    onDeliveryComplete(deliveryId)
                }
            }
        )
    }
}
