package com.zaki.taksometr.presentation.delivery

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.service.LocationTrackingService
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A marketplace order that is available to be accepted as a second order. */
data class PendingOrderInfo(
    val id: String = "",
    val clientPhone: String = "",
    val comment: String = "",
    val pickupAddress: String = "",
    val destinationAddress: String = ""
)

data class ActiveDeliveryState(
    val delivery: Delivery? = null,
    val routePoints: List<GeoPoint> = emptyList(),
    val currentLocation: GeoPoint? = null,
    val distanceMeters: Double = 0.0,
    val elapsedTime: Long = 0L,
    val currentCost: Double = 0.0,
    val isWaiting: Boolean = false,
    val totalWaitingMs: Long = 0L,
    val isCompleting: Boolean = false,
    val isUpdatingStage: Boolean = false,
    // The other active order (paused) when the courier is handling two at once.
    val pausedDelivery: Delivery? = null,
    val activeCount: Int = 0,
    // A new marketplace order that can be accepted as a second order.
    val pendingOrder: PendingOrderInfo? = null,
    val isSwitching: Boolean = false,
    val isAcceptingOrder: Boolean = false,
    val error: String? = null
) {
    val canAcceptMore: Boolean
        get() = activeCount in 1 until Constants.MAX_CONCURRENT_DELIVERIES
}

@HiltViewModel
class ActiveDeliveryViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val deliveryRepository: DeliveryRepository,
    private val tariffRepository: TariffRepository,
    private val routePointDao: RoutePointDao,
    private val deliveryDao: DeliveryDao,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(ActiveDeliveryState())
    val state: StateFlow<ActiveDeliveryState> = _state.asStateFlow()

    // Id of the delivery whose meter is currently running. Drives route
    // observation and can change when the courier switches/resumes orders.
    private val currentIdFlow = MutableStateFlow(deliveryRepository.getCurrentActiveDeliveryId())

    private val courierId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    // Always the true current delivery (source of truth = prefs).
    private val activeDeliveryId: String
        get() = deliveryRepository.getCurrentActiveDeliveryId()

    private var pendingListener: ListenerRegistration? = null

    init {
        observeDeliveries()
        observeRoute()
        startTimer()
        observePendingOrders()
    }

    private fun log(msg: String) {
        android.util.Log.d("ActiveDeliveryVM", msg)
    }

    private fun observeDeliveries() {
        viewModelScope.launch {
            combine(deliveryRepository.getActiveDeliveries(), currentIdFlow) { list, curId ->
                list to curId
            }.collect { (list, curId) ->
                val current = list.firstOrNull { it.id == curId } ?: list.firstOrNull()
                if (current != null && current.id != currentIdFlow.value) {
                    currentIdFlow.value = current.id
                }
                val paused = list.firstOrNull { it.id != current?.id }
                log("observeDeliveries: active=${list.size}, current=${current?.id}, paused=${paused?.id}")
                _state.value = _state.value.copy(
                    delivery = current,
                    pausedDelivery = paused,
                    activeCount = list.size,
                    isWaiting = current?.waitingStartedAt != null,
                    // Hide the pending-order offer once the courier is at the limit.
                    pendingOrder = if (list.size >= Constants.MAX_CONCURRENT_DELIVERIES) null else _state.value.pendingOrder
                )
            }
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observeRoute() {
        viewModelScope.launch {
            currentIdFlow.flatMapLatest { id ->
                if (id.isEmpty()) flowOf(emptyList()) else routePointDao.getPointsByDeliveryId(id)
            }.collect { entities ->
                val points = entities.map { it.toGeoPoint() }

                val current = _state.value.delivery
                val isMarketplace = current?.orderKind == "MARKETPLACE"
                val distancePoints = if (isMarketplace) {
                    val onTheWayAt = current?.onTheWayStartedAt
                        ?: prefs.getLong(Constants.PREF_ON_THE_WAY_STARTED_AT, 0L)
                    if (onTheWayAt > 0L) points.filter { it.timestamp >= onTheWayAt } else emptyList()
                } else {
                    points
                }

                val distance = LocationUtils.calculateTotalDistance(distancePoints)
                val cost = tariffRepository.calculateCost(distance)

                _state.value = _state.value.copy(
                    routePoints = points,
                    currentLocation = points.lastOrNull(),
                    distanceMeters = distance,
                    currentCost = cost
                )
            }
        }
    }

    private fun startTimer() {
        viewModelScope.launch {
            while (true) {
                val delivery = _state.value.delivery
                if (delivery != null) {
                    val elapsed = System.currentTimeMillis() - delivery.startTime
                    val running = delivery.waitingStartedAt
                        ?.let { (System.currentTimeMillis() - it).coerceAtLeast(0L) } ?: 0L
                    val totalWaiting = delivery.waitingAccumulatedMs + running
                    _state.value = _state.value.copy(
                        elapsedTime = elapsed,
                        totalWaitingMs = totalWaiting,
                        isWaiting = delivery.waitingStartedAt != null
                    )
                }
                delay(1000)
            }
        }
    }

    fun toggleWaiting() {
        val current = _state.value.delivery ?: return
        val currentId = current.id
        val isMarketplaceOrder = current.orderKind == "MARKETPLACE"
        val startWaiting = current.waitingStartedAt == null
        viewModelScope.launch {
            if (isMarketplaceOrder) {
                updateMarketplaceStage(waitingAction = if (startWaiting) "START" else "STOP")
            } else {
                deliveryRepository.setDeliveryWaiting(currentId, startWaiting)
            }
        }
    }

    /** Explicitly pause the current order (freeze its meter and waiting). */
    fun pauseCurrent() {
        val current = _state.value.delivery ?: return
        if (current.isPaused) return
        viewModelScope.launch {
            // For marketplace orders, stop the server-side waiting timer too.
            if (current.orderKind == "MARKETPLACE" && current.waitingStartedAt != null) {
                deliveryRepository.updateMarketplaceDeliveryStage(current.id, null, "STOP")
            }
            deliveryRepository.setDeliveryPaused(current.id, true)
            LocationTrackingService.switchService(context)
        }
    }

    /** Resume the current order after an explicit pause. */
    fun resumeCurrent() {
        val current = _state.value.delivery ?: return
        if (!current.isPaused) return
        viewModelScope.launch {
            deliveryRepository.setDeliveryPaused(current.id, false)
            LocationTrackingService.switchService(context)
        }
    }

    /** Resume/switch to another active order (its meter runs, the other pauses). */
    fun switchTo(deliveryId: String) {
        if (deliveryId.isEmpty() || deliveryId == activeDeliveryId) return
        viewModelScope.launch {
            _state.value = _state.value.copy(isSwitching = true, error = null)
            deliveryRepository.setCurrentActiveDelivery(deliveryId)
            currentIdFlow.value = deliveryId
            LocationTrackingService.switchService(context)
            _state.value = _state.value.copy(isSwitching = false)
        }
    }

    /** Accept a newly-offered marketplace order as a second (concurrent) order. */
    fun acceptPendingOrder(orderId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isAcceptingOrder = true, error = null)
            when (val result = deliveryRepository.acceptMarketplaceDelivery(orderId)) {
                is Resource.Success -> {
                    val newId = result.data?.id ?: deliveryRepository.getCurrentActiveDeliveryId()
                    currentIdFlow.value = newId
                    LocationTrackingService.switchService(context)
                    _state.value = _state.value.copy(isAcceptingOrder = false, pendingOrder = null)
                }
                is Resource.Error -> {
                    val message = result.message ?: "Заказ уже принял другой курьер"
                    _state.value = _state.value.copy(
                        isAcceptingOrder = false,
                        pendingOrder = null,
                        error = if (message.contains("Accepted by:")) "Заказ уже принял другой курьер" else message
                    )
                }
                is Resource.Loading -> Unit
            }
        }
    }

    fun updateMarketplaceStage(stage: String? = null, waitingAction: String? = null) {
        val currentDeliveryId = activeDeliveryId
        if (currentDeliveryId.isEmpty()) return

        viewModelScope.launch {
            if (stage != null) _state.value = _state.value.copy(isUpdatingStage = true, error = null)
            when (val result = deliveryRepository.updateMarketplaceDeliveryStage(currentDeliveryId, stage, waitingAction)) {
                is Resource.Error -> {
                    _state.value = _state.value.copy(error = result.message)
                }
                is Resource.Success -> {
                    // When courier starts driving to client, reset km/cost counter to 0 immediately
                    if (stage == "ON_THE_WAY") {
                        _state.value = _state.value.copy(distanceMeters = 0.0, currentCost = 0.0)
                    }
                }
                else -> Unit
            }
            deliveryRepository.syncDeliveryStatusFromFirestore(currentDeliveryId)
            if (stage != null) _state.value = _state.value.copy(isUpdatingStage = false)
        }
    }

    fun completeDelivery(onComplete: (String) -> Unit) {
        val currentDeliveryId = activeDeliveryId
        if (currentDeliveryId.isEmpty()) {
            _state.value = _state.value.copy(error = "Ошибка: ID доставки не найден. Перезапустите приложение.")
            return
        }

        val delivery = _state.value.delivery
        if (delivery?.status != DeliveryStatus.IN_PROGRESS) {
            _state.value = _state.value.copy(
                error = "Доставка не в статусе 'В процессе'. Текущий статус: ${delivery?.status ?: "null"}."
            )
            return
        }

        // Total waiting = frozen accumulated + any currently-running interval.
        val running = delivery.waitingStartedAt
            ?.let { (System.currentTimeMillis() - it).coerceAtLeast(0L) } ?: 0L
        val waitingMinutes = (delivery.waitingAccumulatedMs + running) / 60000.0

        viewModelScope.launch {
            _state.value = _state.value.copy(isCompleting = true, error = null)
            when (val result = deliveryRepository.completeDelivery(currentDeliveryId, waitingMinutes)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(isCompleting = false)
                    // If another (paused) order was promoted to current, re-anchor tracking.
                    val remainingId = deliveryRepository.getCurrentActiveDeliveryId()
                    if (remainingId.isNotEmpty()) {
                        currentIdFlow.value = remainingId
                        LocationTrackingService.switchService(context)
                    }
                    onComplete(currentDeliveryId)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isCompleting = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> Unit
            }
        }
    }

    fun cancelDelivery(onCancelled: () -> Unit) {
        val currentDeliveryId = activeDeliveryId
        if (currentDeliveryId.isEmpty()) {
            _state.value = _state.value.copy(error = "Ошибка: ID доставки не найден.")
            return
        }

        viewModelScope.launch {
            when (deliveryRepository.cancelDelivery(currentDeliveryId)) {
                is Resource.Success -> {
                    val remainingId = deliveryRepository.getCurrentActiveDeliveryId()
                    if (remainingId.isNotEmpty()) {
                        currentIdFlow.value = remainingId
                        LocationTrackingService.switchService(context)
                    }
                    onCancelled()
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(error = "Ошибка отмены доставки")
                }
                is Resource.Loading -> Unit
            }
        }
    }

    private fun observePendingOrders() {
        val cId = courierId
        if (cId.isEmpty()) return
        pendingListener?.remove()
        pendingListener = FirebaseFirestore.getInstance()
            .collection("deliveries")
            .whereEqualTo("status", "PENDING")
            .whereEqualTo("orderKind", "MARKETPLACE")
            .whereArrayContains("availableCourierIds", cId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    log("pending listener error: ${error.message}")
                    return@addSnapshotListener
                }
                // Only offer a new order if the courier is below the concurrency limit.
                if (_state.value.activeCount >= Constants.MAX_CONCURRENT_DELIVERIES) {
                    _state.value = _state.value.copy(pendingOrder = null)
                    return@addSnapshotListener
                }
                val doc = snapshot?.documents?.firstOrNull { it.id != activeDeliveryId }
                if (doc == null) {
                    _state.value = _state.value.copy(pendingOrder = null)
                    return@addSnapshotListener
                }
                val pickup = doc.get("pickup") as? Map<*, *>
                val destination = doc.get("destination") as? Map<*, *>
                _state.value = _state.value.copy(
                    pendingOrder = PendingOrderInfo(
                        id = doc.id,
                        clientPhone = doc.getString("clientPhone") ?: "",
                        comment = doc.getString("comment") ?: "",
                        pickupAddress = pickup?.get("address") as? String ?: "",
                        destinationAddress = destination?.get("address") as? String ?: ""
                    )
                )
            }
    }

    override fun onCleared() {
        pendingListener?.remove()
        pendingListener = null
        super.onCleared()
    }
}
