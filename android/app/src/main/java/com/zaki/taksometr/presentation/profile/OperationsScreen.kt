package com.zaki.taksometr.presentation.profile

import com.zaki.taksometr.presentation.theme.CourierSky
import com.zaki.taksometr.presentation.theme.CourierInk
import com.zaki.taksometr.presentation.theme.CourierBlueDark
import com.zaki.taksometr.presentation.theme.CourierCanvas
import android.content.SharedPreferences
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.zaki.taksometr.presentation.theme.AccentGreen
import com.zaki.taksometr.presentation.theme.AccentRed
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

data class CourierOperation(
    val id: String,
    val type: String,
    val amount: Double,
    val createdAt: Long,
    val description: String,
    val deliveryId: String,
    val balanceAfter: Double?,
    val paymentStatus: String
)

data class OperationsState(
    val items: List<CourierOperation> = emptyList(),
    val loading: Boolean = false,
    val hasMore: Boolean = true,
    val error: String? = null
)

@HiltViewModel
class OperationsViewModel @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val prefs: SharedPreferences
) : ViewModel() {
    private val _state = MutableStateFlow(OperationsState())
    val state = _state.asStateFlow()
    private var cursor: DocumentSnapshot? = null

    init { loadMore() }

    fun refresh() {
        if (_state.value.loading) return
        cursor = null
        _state.value = OperationsState()
        loadMore()
    }

    fun loadMore() {
        if (_state.value.loading || !_state.value.hasMore) return
        val courierId = prefs.getString(Constants.PREF_USER_ID, null)
        if (courierId.isNullOrBlank()) {
            _state.value = _state.value.copy(error = "Войдите в аккаунт курьера", hasMore = false)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                var query = firestore.collection("transactions")
                    .whereEqualTo("courierId", courierId)
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .limit(50)
                cursor?.let { query = query.startAfter(it) }
                val page = query.get().await()
                val items = page.documents.map { doc ->
                    CourierOperation(
                        id = doc.id,
                        type = doc.getString("type").orEmpty(),
                        amount = (doc.get("amount") as? Number)?.toDouble() ?: 0.0,
                        createdAt = doc.getLong("createdAt") ?: 0L,
                        description = doc.getString("description").orEmpty(),
                        deliveryId = doc.getString("deliveryId").orEmpty(),
                        balanceAfter = (doc.get("balanceAfter") as? Number)?.toDouble(),
                        paymentStatus = doc.getString("paymentStatus").orEmpty()
                    )
                }
                cursor = page.documents.lastOrNull()
                _state.value = _state.value.copy(
                    items = _state.value.items + items,
                    hasMore = page.size() == 50,
                    loading = false
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = e.localizedMessage ?: "Не удалось загрузить операции"
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OperationsScreen(
    onBack: () -> Unit,
    onDeliveryClick: (String) -> Unit,
    viewModel: OperationsViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    Scaffold(
        containerColor = CourierCanvas,

        topBar = {
            TopAppBar(
                title = { Text("Комиссии и операции") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Назад")
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CourierSky,
                    titleContentColor = CourierInk,
                    navigationIconContentColor = CourierBlueDark,
                    actionIconContentColor = CourierBlueDark
                )
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(horizontal = 16.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Text("Комиссии за доставки, возвраты, пополнения и переводы",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(state.items, key = { it.id }) { operation ->
                Card(
                    modifier = Modifier.fillMaxWidth().then(
                        if (operation.deliveryId.isNotBlank()) Modifier.clickable {
                            onDeliveryClick(operation.deliveryId)
                        } else Modifier
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(operationLabel(operation.type), fontWeight = FontWeight.SemiBold)
                            Text(
                                (when {
                                    operation.amount > 0 -> "+"
                                    operation.amount < 0 -> "−"
                                    else -> ""
                                }) +
                                    LocationUtils.formatCost(kotlin.math.abs(operation.amount)),
                                fontWeight = FontWeight.Bold,
                                color = if (operation.amount >= 0) AccentGreen else AccentRed
                            )
                        }
                        if (operation.deliveryId.isNotBlank()) {
                            Text("Доставка №${operation.deliveryId.take(8)} · открыть заказ",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary)
                        }
                        if (operation.description.isNotBlank()) {
                            Text(operation.description, style = MaterialTheme.typography.bodySmall)
                        }
                        if (operation.paymentStatus.isNotBlank()) {
                            Text(if (operation.paymentStatus == "PAID") "Оплачено" else "Долг",
                                style = MaterialTheme.typography.bodySmall)
                        }
                        Text(
                            SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
                                .format(Date(operation.createdAt)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        operation.balanceAfter?.let {
                            Text("Баланс после операции: ${LocationUtils.formatCost(it)}",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            if (state.items.isEmpty() && !state.loading && state.error == null) {
                item { Text("Операций пока нет") }
            }
            state.error?.let { error ->
                item { Text(error, color = MaterialTheme.colorScheme.error) }
            }
            if (state.loading) {
                item { CircularProgressIndicator() }
            } else if (state.hasMore) {
                item {
                    Button(onClick = viewModel::loadMore, modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.error == null) "Загрузить ещё" else "Повторить")
                    }
                }
            }
        }
    }
}

private fun operationLabel(type: String): String = when (type) {
    "COMMISSION" -> "Комиссия"
    "COMMISSION_REFUND" -> "Возврат комиссии"
    "TOP_UP" -> "Пополнение баланса"
    "BALANCE_DEDUCTION" -> "Списание баланса"
    "COURIER_TRANSFER" -> "Перевод между курьерами"
    else -> type.ifBlank { "Операция" }
}
