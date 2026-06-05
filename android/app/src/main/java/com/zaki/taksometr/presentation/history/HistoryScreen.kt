package com.zaki.taksometr.presentation.history

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
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
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.str
import com.zaki.taksometr.util.Strings
import java.text.SimpleDateFormat
import java.util.*

enum class DateFilter(val label: String) {
    ALL("Все"),
    TODAY("Сегодня"),
    YESTERDAY("Вчера"),
    WEEK("Неделя"),
    MONTH("Месяц"),
    YEAR("Год")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    onDeliveryClick: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: HistoryViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    var selectedFilter by remember { mutableStateOf(DateFilter.ALL) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(str(Strings.deliveryHistory)) },
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
            // Search bar
            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = {
                    selectedFilter = DateFilter.ALL
                    viewModel.onSearchQueryChange(it)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                placeholder = { Text(str(Strings.searchByPhone)) },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null)
                },
                trailingIcon = {
                    if (state.searchQuery.isNotEmpty()) {
                        IconButton(onClick = {
                            selectedFilter = DateFilter.ALL
                            viewModel.clearFilters()
                        }) {
                            Icon(Icons.Default.Clear, contentDescription = "Очистить")
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            // Date filter chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DateFilter.values().forEach { filter ->
                    FilterChip(
                        selected = selectedFilter == filter,
                        onClick = {
                            selectedFilter = filter
                            applyDateFilter(filter, viewModel)
                        },
                        label = { Text(filter.label) },
                        shape = RoundedCornerShape(20.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Delivery list
            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (state.deliveries.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.Inbox,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = "Нет доставок",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(state.deliveries) { delivery ->
                        DeliveryHistoryItem(
                            delivery = delivery,
                            onClick = { onDeliveryClick(delivery.id) }
                        )
                    }
                }
            }
        }
    }
}

private fun applyDateFilter(filter: DateFilter, viewModel: HistoryViewModel) {
    when (filter) {
        DateFilter.ALL -> viewModel.clearFilters()
        else -> {
            val calendar = Calendar.getInstance()
            val endDate = calendar.timeInMillis

            // Set start of day
            calendar.set(Calendar.HOUR_OF_DAY, 0)
            calendar.set(Calendar.MINUTE, 0)
            calendar.set(Calendar.SECOND, 0)
            calendar.set(Calendar.MILLISECOND, 0)

            val startDate = when (filter) {
                DateFilter.TODAY -> calendar.timeInMillis
                DateFilter.YESTERDAY -> {
                    calendar.add(Calendar.DAY_OF_YEAR, -1)
                    calendar.timeInMillis
                }
                DateFilter.WEEK -> {
                    calendar.add(Calendar.DAY_OF_YEAR, -7)
                    calendar.timeInMillis
                }
                DateFilter.MONTH -> {
                    calendar.add(Calendar.MONTH, -1)
                    calendar.timeInMillis
                }
                DateFilter.YEAR -> {
                    calendar.add(Calendar.YEAR, -1)
                    calendar.timeInMillis
                }
                else -> calendar.timeInMillis
            }

            viewModel.filterByDateRange(startDate, endDate)
        }
    }
}

@Composable
fun DeliveryHistoryItem(
    delivery: Delivery,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status icon
            Icon(
                when (delivery.status) {
                    DeliveryStatus.COMPLETED -> Icons.Default.CheckCircle
                    DeliveryStatus.CANCELLED -> Icons.Default.Cancel
                    DeliveryStatus.IN_PROGRESS -> Icons.Default.DirectionsBike
                },
                contentDescription = null,
                tint = when (delivery.status) {
                    DeliveryStatus.COMPLETED -> StatusCompleted
                    DeliveryStatus.CANCELLED -> StatusCancelled
                    DeliveryStatus.IN_PROGRESS -> StatusDelivery
                },
                modifier = Modifier.size(40.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = delivery.clientPhone,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row {
                    Text(
                        text = LocationUtils.formatDistance(delivery.distanceMeters),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                    Text(
                        text = " • ",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                    )
                    Text(
                        text = SimpleDateFormat("dd.MM.yy HH:mm", Locale.getDefault())
                            .format(Date(delivery.createdAt)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
            }

            Text(
                text = LocationUtils.formatCost(delivery.cost),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = AccentGreen
            )
        }
    }
}
