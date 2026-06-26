package com.zaki.taksometr.presentation.delivery

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.GeoPoint
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.TariffRepository
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

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
    val error: String? = null
)

@HiltViewModel
class ActiveDeliveryViewModel @Inject constructor(
    private val deliveryRepository: DeliveryRepository,
    private val tariffRepository: TariffRepository,
    private val routePointDao: RoutePointDao,
    private val deliveryDao: DeliveryDao,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(ActiveDeliveryState())
    val state: StateFlow<ActiveDeliveryState> = _state.asStateFlow()

    private val deliveryId: String
        get() = prefs.getString(Constants.PREF_ACTIVE_DELIVERY_ID, "") ?: ""

    private var waitingStartTime: Long = 0L
    private var accumulatedWaitingMs: Long = 0L

    init {
        observeDelivery()
        observeRoute()
        startTimer()
    }

    private fun log(msg: String) {
        android.util.Log.d("ActiveDeliveryVM", msg)
    }

    private fun observeDelivery() {
        viewModelScope.launch {
            deliveryRepository.getActiveDelivery().collect { delivery ->
                log("observeDelivery: status=${delivery?.status}, id=${delivery?.id}")
                _state.value = _state.value.copy(delivery = delivery)
            }
        }
    }

    private fun observeRoute() {
        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) {
            log("observeRoute: deliveryId is EMPTY!")
            return
        }

        viewModelScope.launch {
            routePointDao.getPointsByDeliveryId(currentDeliveryId).collect { entities ->
                val points = entities.map { it.toGeoPoint() }
                val distance = LocationUtils.calculateTotalDistance(points)
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
                    val totalWaiting = if (_state.value.isWaiting && waitingStartTime > 0) {
                        accumulatedWaitingMs + (System.currentTimeMillis() - waitingStartTime)
                    } else {
                        accumulatedWaitingMs
                    }
                    _state.value = _state.value.copy(
                        elapsedTime = elapsed,
                        totalWaitingMs = totalWaiting
                    )
                }
                delay(1000)
            }
        }
    }

    fun toggleWaiting() {
        val isMarketplaceOrder = _state.value.delivery?.orderKind == "MARKETPLACE"
        if (_state.value.isWaiting) {
            if (waitingStartTime > 0) {
                accumulatedWaitingMs += System.currentTimeMillis() - waitingStartTime
            }
            waitingStartTime = 0L
            _state.value = _state.value.copy(
                isWaiting = false,
                totalWaitingMs = accumulatedWaitingMs
            )
            if (isMarketplaceOrder) {
                updateMarketplaceStage(waitingAction = "STOP")
            }
        } else {
            waitingStartTime = System.currentTimeMillis()
            _state.value = _state.value.copy(isWaiting = true)
            if (isMarketplaceOrder) {
                updateMarketplaceStage(waitingAction = "START")
            }
        }
    }

    fun updateMarketplaceStage(stage: String? = null, waitingAction: String? = null) {
        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) return

        viewModelScope.launch {
            if (stage != null) _state.value = _state.value.copy(isUpdatingStage = true, error = null)
            when (val result = deliveryRepository.updateMarketplaceDeliveryStage(currentDeliveryId, stage, waitingAction)) {
                is Resource.Error -> {
                    _state.value = _state.value.copy(error = result.message)
                }
                else -> Unit
            }
            deliveryRepository.syncDeliveryStatusFromFirestore(currentDeliveryId)
            if (stage != null) _state.value = _state.value.copy(isUpdatingStage = false)
        }
    }

    fun completeDelivery(onComplete: (String) -> Unit) {
        val currentDeliveryId = deliveryId
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

        if (_state.value.isWaiting) {
            toggleWaiting()
        }

        val waitingMinutes = accumulatedWaitingMs / 60000.0

        viewModelScope.launch {
            _state.value = _state.value.copy(isCompleting = true, error = null)
            when (val result = deliveryRepository.completeDelivery(currentDeliveryId, waitingMinutes)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(isCompleting = false)
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
        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) {
            _state.value = _state.value.copy(error = "Ошибка: ID доставки не найден.")
            return
        }

        viewModelScope.launch {
            when (deliveryRepository.cancelDelivery(currentDeliveryId)) {
                is Resource.Success -> onCancelled()
                is Resource.Error -> {
                    _state.value = _state.value.copy(error = "Ошибка отмены доставки")
                }
                is Resource.Loading -> Unit
            }
        }
    }
}
