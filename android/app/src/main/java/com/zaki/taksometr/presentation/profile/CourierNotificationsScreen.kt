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
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.functions.FirebaseFunctions
import com.zaki.taksometr.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

data class CourierInboxItem(
    val id: String,
    val type: String,
    val title: String,
    val body: String,
    val createdAt: Long,
    val deliveryId: String
)

data class CourierInboxState(
    val items: List<CourierInboxItem> = emptyList(),
    val nextCursor: String? = null,
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val hasUnread: Boolean = false
)

internal fun visibleDeliveryId(type: String, deliveryId: String): String =
    if (type == "ADMIN_MARKETPLACE_ORDER") "" else deliveryId

@HiltViewModel
class CourierNotificationsViewModel @Inject constructor(
    private val functions: FirebaseFunctions,
    private val prefs: SharedPreferences
) : ViewModel() {
    private val _state = MutableStateFlow(CourierInboxState())
    val state = _state.asStateFlow()

    init { refresh() }

    private val courierId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "").orEmpty()

    private val readKey: String
        get() = "courier_notifications_read_$courierId"

    fun refresh() {
        if (_state.value.loading) return
        _state.value = CourierInboxState()
        loadMore()
    }

    fun loadMore() {
        val current = _state.value
        if (current.loading || (current.loaded && current.nextCursor == null)) return
        if (courierId.isBlank()) {
            _state.value = current.copy(error = "Войдите в аккаунт курьера", loaded = true)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val request = mutableMapOf<String, Any>(
                    "courierId" to courierId,
                    "limit" to 50
                )
                current.nextCursor?.let { request["afterId"] = it }
                val result = functions.getHttpsCallable("getCourierNotifications")
                    .call(request).await().data as? Map<*, *> ?: emptyMap<Any, Any>()
                val page = (result["notifications"] as? List<*>).orEmpty().mapNotNull { raw ->
                    val row = raw as? Map<*, *> ?: return@mapNotNull null
                    val type = row["type"] as? String ?: ""
                    CourierInboxItem(
                        id = row["id"] as? String ?: return@mapNotNull null,
                        type = type,
                        title = row["title"] as? String ?: "Уведомление",
                        body = row["body"] as? String ?: "",
                        createdAt = (row["createdAt"] as? Number)?.toLong() ?: 0L,
                        deliveryId = visibleDeliveryId(type, row["deliveryId"] as? String ?: "")
                    )
                }
                val allItems = (_state.value.items + page).distinctBy { it.id }
                val readAt = prefs.getLong(readKey, 0L)
                _state.value = _state.value.copy(
                    items = allItems,
                    nextCursor = result["nextCursor"] as? String,
                    loaded = true,
                    loading = false,
                    hasUnread = allItems.any { it.createdAt > readAt }
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = e.localizedMessage ?: "Не удалось загрузить уведомления"
                )
            }
        }
    }

    fun markRead() {
        val newest = _state.value.items.maxOfOrNull { it.createdAt } ?: System.currentTimeMillis()
        prefs.edit().putLong(readKey, maxOf(newest, prefs.getLong(readKey, 0L))).apply()
        _state.value = _state.value.copy(hasUnread = false)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourierNotificationsScreen(
    onBack: () -> Unit,
    onDeliveryClick: (String) -> Unit,
    viewModel: CourierNotificationsViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(state.loaded, state.items.size) {
        if (state.loaded) viewModel.markRead()
    }
    Scaffold(
        containerColor = CourierCanvas,

        topBar = {
            TopAppBar(
                title = { Text("Уведомления") },
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
            items(state.items, key = { it.id }) { item ->
                val canOpenDelivery = item.deliveryId.isNotBlank() &&
                    item.type != "ADMIN_MARKETPLACE_ORDER"
                Card(
                    modifier = Modifier.fillMaxWidth().then(
                        if (canOpenDelivery) Modifier.clickable {
                            onDeliveryClick(item.deliveryId)
                        } else Modifier
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(modifier = Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.Top) {
                        Icon(Icons.Default.Notifications, contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(item.title, fontWeight = FontWeight.SemiBold)
                            if (item.body.isNotBlank()) Text(item.body)
                            if (canOpenDelivery) {
                                Text("Открыть заказ", color = MaterialTheme.colorScheme.primary,
                                    style = MaterialTheme.typography.bodySmall)
                            } else if (item.type == "ADMIN_MARKETPLACE_ORDER") {
                                Text("Примите заказ на главном экране",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodySmall)
                            }
                            Text(
                                SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
                                    .format(Date(item.createdAt)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
            if (state.loaded && state.items.isEmpty() && state.error == null) {
                item { Text("Уведомлений пока нет") }
            }
            state.error?.let { error ->
                item { Text(error, color = MaterialTheme.colorScheme.error) }
            }
            if (state.loading) {
                item { CircularProgressIndicator() }
            } else if (state.nextCursor != null) {
                item {
                    Button(onClick = viewModel::loadMore, modifier = Modifier.fillMaxWidth()) {
                        Text("Загрузить ещё")
                    }
                }
            } else if (state.error != null) {
                item {
                    Button(onClick = viewModel::refresh, modifier = Modifier.fillMaxWidth()) {
                        Text("Повторить")
                    }
                }
            }
        }
    }
}
