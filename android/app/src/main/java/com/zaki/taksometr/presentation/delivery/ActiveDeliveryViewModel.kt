package com.zaki.taksometr.presentation.delivery

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.data.local.dao.DeliveryDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.domain.model.Delivery
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

    init {
        observeDelivery()
        observeRoute()
        startTimer()
    }

    private fun observeDelivery() {
        viewModelScope.launch {
            deliveryRepository.getActiveDelivery().collect { delivery ->
                _state.value = _state.value.copy(delivery = delivery)
            }
        }
    }

    private fun observeRoute() {
        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) return

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
                    _state.value = _state.value.copy(elapsedTime = elapsed)
                }
                delay(1000)
            }
        }
    }

    fun completeDelivery(onComplete: (String) -> Unit) {
        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) return

        viewModelScope.launch {
            _state.value = _state.value.copy(isCompleting = true, error = null)

            when (val result = deliveryRepository.completeDelivery(currentDeliveryId)) {
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
                is Resource.Loading -> {}
            }
        }
    }

    fun cancelDelivery(onCancelled: () -> Unit) {
        val currentDeliveryId = deliveryId
        if (currentDeliveryId.isEmpty()) return

        viewModelScope.launch {
            when (deliveryRepository.cancelDelivery(currentDeliveryId)) {
                is Resource.Success -> onCancelled()
                is Resource.Error -> {
                    _state.value = _state.value.copy(error = "Ошибка отмены доставки")
                }
                is Resource.Loading -> {}
            }
        }
    }
}
