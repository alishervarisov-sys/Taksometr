package com.zaki.taksometr.presentation.deliverychain

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zaki.taksometr.domain.model.ChainDeliveryItem
import com.zaki.taksometr.domain.model.DeliveryChainStatus
import com.zaki.taksometr.domain.model.DeliveryStatus
import org.burnoutcrew.reorderable.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeliveryChainScreen(
    onBack: () -> Unit,
    viewModel: DeliveryChainViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Дерево заказов") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Назад")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        },
        floatingActionButton = {
            if (state.currentChain != null && 
                state.currentChain?.status == DeliveryChainStatus.DRAFT) {
                FloatingActionButton(
                    onClick = { viewModel.showDeliveryTypeDialog() },
                    containerColor = MaterialTheme.colorScheme.primary
                ) {
                    Icon(Icons.Default.Add, "Добавить заказ")
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (state.currentChain == null) {
                // Нет активной цепочки - показываем кнопку создания
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        Icons.Default.List,
                        contentDescription = null,
                        modifier = Modifier.size(80.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        "Создайте дерево заказов",
                        style = MaterialTheme.typography.headlineSmall
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Добавляйте заказы и управляйте очередностью доставки",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.Gray
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Button(
                        onClick = { viewModel.createNewChain() },
                        enabled = !state.isLoading
                    ) {
                        Icon(Icons.Default.Add, null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Создать дерево заказов")
                    }
                }
            } else {
                // Есть активная цепочка
                DeliveryChainContent(
                    chain = state.currentChain!!,
                    onRemoveItem = { viewModel.removeItem(it) },
                    onReorderItems = { viewModel.moveItem(it) },
                    onStartChain = { viewModel.startChain() },
                    onCompleteAndNext = { viewModel.completeCurrentAndMoveNext(it) },
                    onCancelChain = { viewModel.cancelChain() }
                )
            }

            // Диалог выбора типа доставки
            if (state.showDeliveryTypeDialog) {
                DeliveryTypeDialog(
                    fixedTypes = state.fixedTypes,
                    onDismiss = { viewModel.hideDeliveryTypeDialog() },
                    onSelect = { viewModel.onDeliveryTypeSelected(it) }
                )
            }

            // Диалог добавления заказа
            if (state.showAddItemDialog) {
                AddItemDialog(
                    clientPhone = state.clientPhone,
                    orderNumber = state.orderNumber,
                    deliveryType = state.selectedDeliveryType,
                    fixedTypes = state.fixedTypes,
                    onClientPhoneChange = { viewModel.onClientPhoneChange(it) },
                    onOrderNumberChange = { viewModel.onOrderNumberChange(it) },
                    onDismiss = { viewModel.hideAddItemDialog() },
                    onConfirm = { viewModel.addItemToChain() },
                    error = state.error
                )
            }

            if (state.isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }
    }
}

@Composable
fun DeliveryChainContent(
    chain: com.zaki.taksometr.domain.model.DeliveryChain,
    onRemoveItem: (String) -> Unit,
    onReorderItems: (List<ChainDeliveryItem>) -> Unit,
    onStartChain: () -> Unit,
    onCompleteAndNext: (Double) -> Unit,
    onCancelChain: () -> Unit
) {
    var waitingMinutes by remember { mutableStateOf("") }
    val reorderState = rememberReorderableLazyListState(
        onMove = { from, to ->
            val items = chain.items.toMutableList()
            items.add(to.index, items.removeAt(from.index))
            onReorderItems(items.mapIndexed { index, item ->
                item.copy(sequenceOrder = index + 1)
            })
        }
    )

    Column(modifier = Modifier.fillMaxSize()) {
        // Статус цепочки
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = when (chain.status) {
                    DeliveryChainStatus.DRAFT -> MaterialTheme.colorScheme.secondaryContainer
                    DeliveryChainStatus.IN_PROGRESS -> MaterialTheme.colorScheme.primaryContainer
                    DeliveryChainStatus.COMPLETED -> Color(0xFF4CAF50).copy(alpha = 0.2f)
                    DeliveryChainStatus.CANCELLED -> Color(0xFFF44336).copy(alpha = 0.2f)
                }
            )
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = when (chain.status) {
                        DeliveryChainStatus.DRAFT -> "Черновик"
                        DeliveryChainStatus.IN_PROGRESS -> "Выполняется"
                        DeliveryChainStatus.COMPLETED -> "Завершено"
                        DeliveryChainStatus.CANCELLED -> "Отменено"
                    },
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "Заказов: ${chain.items.size}",
                    style = MaterialTheme.typography.bodyLarge
                )
                if (chain.status == DeliveryChainStatus.IN_PROGRESS) {
                    val completed = chain.items.count { it.status == DeliveryStatus.COMPLETED }
                    Text(
                        "Завершено: $completed из ${chain.items.size}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }

        // Список заказов
        LazyColumn(
            state = reorderState.listState,
            modifier = Modifier
                .weight(1f)
                .reorderable(reorderState)
        ) {
            itemsIndexed(chain.items, key = { _, item -> item.id }) { _, item ->
                ReorderableItem(reorderState, key = item.id) { isDragging ->
                    ChainItemCard(
                        item = item,
                        isDraft = chain.status == DeliveryChainStatus.DRAFT,
                        isDragging = isDragging,
                        onRemove = { onRemoveItem(item.id) }
                    )
                }
            }
        }

        // Кнопки действий
        when (chain.status) {
            DeliveryChainStatus.DRAFT -> {
                Button(
                    onClick = onStartChain,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    enabled = chain.items.isNotEmpty()
                ) {
                    Icon(Icons.Default.PlayArrow, null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Запустить цепочку")
                }
            }
            DeliveryChainStatus.IN_PROGRESS -> {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                ) {
                    val currentItem = chain.items.firstOrNull { it.status == DeliveryStatus.IN_PROGRESS }
                    if (currentItem != null) {
                        OutlinedTextField(
                            value = waitingMinutes,
                            onValueChange = { waitingMinutes = it },
                            label = { Text("Время ожидания (мин)") },
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Button(
                            onClick = {
                                val minutes = waitingMinutes.toDoubleOrNull() ?: 0.0
                                onCompleteAndNext(minutes)
                                waitingMinutes = ""
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.CheckCircle, null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Завершить и перейти к следующему")
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onCancelChain,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = Color.Red
                        )
                    ) {
                        Icon(Icons.Default.Cancel, null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Отменить цепочку")
                    }
                }
            }
            else -> {
                // Завершено или отменено - только информация
            }
        }
    }
}

@Composable
fun ChainItemCard(
    item: ChainDeliveryItem,
    isDraft: Boolean,
    isDragging: Boolean,
    onRemove: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isDragging) {
                MaterialTheme.colorScheme.surfaceVariant
            } else when (item.status) {
                DeliveryStatus.PENDING -> MaterialTheme.colorScheme.surface
                DeliveryStatus.IN_PROGRESS -> MaterialTheme.colorScheme.primaryContainer
                DeliveryStatus.COMPLETED -> Color(0xFF4CAF50).copy(alpha = 0.2f)
                DeliveryStatus.CANCELLED -> Color(0xFFF44336).copy(alpha = 0.2f)
            }
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (isDragging) 8.dp else 2.dp
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Порядок
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(
                        MaterialTheme.colorScheme.primary,
                        RoundedCornerShape(20.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "${item.sequenceOrder}",
                    color = Color.White,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Информация
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Заказ №${item.orderNumber}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Телефон: ${item.clientPhone}",
                    style = MaterialTheme.typography.bodyMedium
                )
                if (item.deliveryType != "default") {
                    Text(
                        "Тип: ${item.deliveryType}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Text(
                    when (item.status) {
                        DeliveryStatus.PENDING -> "Ожидает"
                        DeliveryStatus.IN_PROGRESS -> "В процессе"
                        DeliveryStatus.COMPLETED -> "Завершено"
                        DeliveryStatus.CANCELLED -> "Отменено"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = when (item.status) {
                        DeliveryStatus.PENDING -> Color.Gray
                        DeliveryStatus.IN_PROGRESS -> MaterialTheme.colorScheme.primary
                        DeliveryStatus.COMPLETED -> Color(0xFF4CAF50)
                        DeliveryStatus.CANCELLED -> Color(0xFFF44336)
                    }
                )
            }

            // Удалить (только в черновике)
            if (isDraft && item.status == DeliveryStatus.PENDING) {
                IconButton(onClick = onRemove) {
                    Icon(Icons.Default.Delete, "Удалить", tint = Color.Red)
                }
            }
        }
    }
}

@Composable
fun DeliveryTypeDialog(
    fixedTypes: Map<String, Double>,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Выберите тип доставки") },
        text = {
            Column {
                // Стандартная доставка
                Card(
                    onClick = { onSelect("default") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Text(
                        "Стандартная доставка (по счетчику)",
                        modifier = Modifier.padding(16.dp)
                    )
                }

                // Фиксированные типы
                fixedTypes.forEach { (type, price) ->
                    Card(
                        onClick = { onSelect(type) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(type, fontWeight = FontWeight.Bold)
                            Text(
                                "${price.toInt()} сомони",
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Отмена")
            }
        }
    )
}

@Composable
fun AddItemDialog(
    clientPhone: String,
    orderNumber: String,
    deliveryType: String,
    fixedTypes: Map<String, Double>,
    onClientPhoneChange: (String) -> Unit,
    onOrderNumberChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    error: String?
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Добавить заказ") },
        text = {
            Column {
                if (deliveryType != "default") {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer
                        )
                    ) {
                        Text(
                            "Тип: $deliveryType (${fixedTypes[deliveryType]?.toInt() ?: 0} сомони)",
                            modifier = Modifier.padding(12.dp),
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                OutlinedTextField(
                    value = clientPhone,
                    onValueChange = onClientPhoneChange,
                    label = { Text("Номер телефона") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = orderNumber,
                    onValueChange = onOrderNumberChange,
                    label = { Text("Номер заказа") },
                    modifier = Modifier.fillMaxWidth()
                )
                error?.let {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(it, color = Color.Red, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            Button(onClick = onConfirm) {
                Text("Добавить")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Отмена")
            }
        }
    )
}
