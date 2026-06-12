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
import kotlinx.coroutines.flow.*
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

    // Waiting time tracking
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
                log("Delivery object: $delivery")
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
        log("observeRoute: deliveryId=$currentDeliveryId")

        viewModelScope.launch {
            routePointDao.getPointsByDeliveryId(currentDeliveryId).collect { entities ->
                val points = entities.map { it.toGeoPoint() }
                val distance = LocationUtils.calculateTotalDistance(points)
                val cost = tariffRepository.calculateCost(distance)
                log("observeRoute: points=${points.size}, distance=${distance.toInt()}m, cost=${cost.toInt()}")

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
                    // Update waiting time if currently waiting
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
        if (_state.value.isWaiting) {
            // Stop waiting
            if (waitingStartTime > 0) {
                accumulatedWaitingMs += System.currentTimeMillis() - waitingStartTime
            }
            waitingStartTime = 0L
            _state.value = _state.value.copy(
                isWaiting = false,
                totalWaitingMs = accumulatedWaitingMs
            )
            log("toggleWaiting: STOPPED. totalWaitingMs=$accumulatedWaitingMs")
        } else {
            // Start waiting
            waitingStartTime = System.currentTimeMillis()
            _state.value = _state.value.copy(isWaiting = true)
            log("toggleWaiting: STARTED.")
        }
    }

    fun completeDelivery(onComplete: (String) -> Unit) {
        val currentDeliveryId = deliveryId
        log("=== COMPLETE DELIVERY ===")
        log("deliveryId=$currentDeliveryId")

        if (currentDeliveryId.isEmpty()) {
            log("ERROR: deliveryId is empty!")
            _state.value = _state.value.copy(
                error = "Ошибка: ID доставки не найден. Перезапустите приложение."
            )
            return
        }

        val delivery = _state.value.delivery
        log("Current delivery status: ${delivery?.status}")
        log("Expected status: IN_PROGRESS")

        // Проверяем, что статус доставки - IN_PROGRESS
        if (delivery?.status != DeliveryStatus.IN_PROGRESS) {
            val errorMsg = "Доставка не в статусе 'В процессе'. Текущий статус: ${delivery?.status ?: "null"}. " +
                    "Пожалуйста, обновите экран или перезапустите приложение."
            log("ERROR: $errorMsg")
            _state.value = _state.value.copy(
                error = errorMsg
            )
            return
        }

        // If still waiting, stop it
        if (_state.value.isWaiting) {
            toggleWaiting()
        }

        val waitingMinutes = (accumulatedWaitingMs / 60000.0)
        log("waitingMinutes=$waitingMinutes")

        viewModelScope.launch {
            _state.value = _state.value.copy(isCompleting = true, error = null)
            log("Calling deliveryRepository.completeDelivery...")

            when (val result = deliveryRepository.completeDelivery(currentDeliveryId, waitingMinutes)) {
                is Resource.Success -> {
                    log("SUCCESS: Delivery completed successfully!")
                    log("Result data: ${result.data}")
                    _state.value = _state.value.copy(isCompleting = false)
                    onComplete(currentDeliveryId)
                }
                is Resource.Error -> {
                    log("ERROR: ${result.message}")
                    _state.value = _state.value.copy(
                        isCompleting = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
            log("=== END COMPLETE ===")
        }
    }

        fun cancelDelivery(onCancelled: () -> Unit) {
        val currentDeliveryId = deliveryId
        log("=== CANCEL DELIVERY ===")
        log("deliveryId=$currentDeliveryId")

        if (currentDeliveryId.isEmpty()) {
            log("ERROR: deliveryId is empty!")
            _state.value = _state.value.copy(
                error = "Ошибка: ID доставки не найден."
            )
            return
        }

        viewModelScope.launch {
            log("Calling deliveryRepository.cancelDelivery...")
            when (deliveryRepository.cancelDelivery(currentDeliveryId)) {
                is Resource.Success -> {
                    log("SUCCESS: Delivery cancelled!")
                    onCancelled()
                }
                is Resource.Error -> {
                    log("ERROR: ${_state.value.error}")
                    _state.value = _state.value.copy(
                        error = "Ошибка отмены доставки"
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }
}
