package com.zaki.taksometr.presentation.home

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.LocationRepository
import com.zaki.taksometr.domain.repository.TodayStats
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeState(
    val user: User? = null,
    val todayStats: TodayStats = TodayStats(),
    val activeDelivery: Delivery? = null,
    val clientPhone: String = "",
    val isStartingDelivery: Boolean = false,
    val showStartDialog: Boolean = false,
    val showDeliveryTypeDialog: Boolean = false,
    val selectedDeliveryType: String = "default",
    val fixedTypes: Map<String, Double> = emptyMap(),
    val isLoadingTariff: Boolean = false,
    val isBlocked: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val deliveryRepository: DeliveryRepository,
    private val locationRepository: LocationRepository,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

        init {
        loadUserData()
        loadTodayStats()
        observeActiveDelivery()
        loadFixedTypes()
        clearStaleActiveDeliveryOnStart()
    }

    private fun clearStaleActiveDeliveryOnStart() {
        viewModelScope.launch {
            android.util.Log.d("HomeViewModel", "Clearing stale active deliveries on startup...")
            deliveryRepository.clearStaleActiveDelivery()
        }
    }

    private var userLoaded = false

    private fun loadUserData() {
        viewModelScope.launch {
            authRepository.getCurrentUser().collect { user ->
                if (user == null && userLoaded) {
                    // User was deleted from Firestore — force logout
                    _state.value = _state.value.copy(user = null, isBlocked = true)
                } else if (user?.isBlocked == true) {
                    // User was blocked — force logout
                    _state.value = _state.value.copy(user = user, isBlocked = true)
                    authRepository.logout()
                } else {
                    _state.value = _state.value.copy(user = user, isBlocked = false)
                }
                if (user != null) userLoaded = true
            }
        }
    }

    private fun loadTodayStats() {
        viewModelScope.launch {
            deliveryRepository.getTodayStats(userId).collect { stats ->
                _state.value = _state.value.copy(todayStats = stats)
            }
        }
    }

    fun refreshCourierLocation() {
        viewModelScope.launch {
            val courierId = _state.value.user?.id ?: userId
            if (courierId.isBlank()) return@launch

            val point = locationRepository.getCurrentLocation() ?: return@launch
            locationRepository.updateCourierLocation(courierId, point)
        }
    }

    private fun observeActiveDelivery() {
        viewModelScope.launch {
            deliveryRepository.getActiveDelivery().collect { delivery ->
                _state.value = _state.value.copy(activeDelivery = delivery)
            }
        }
    }

    fun showStartDialog() {
        _state.value = _state.value.copy(showStartDialog = true, clientPhone = "", error = null)
    }

    fun hideStartDialog() {
        _state.value = _state.value.copy(
            showStartDialog = false, 
            clientPhone = "", 
            selectedDeliveryType = "default",  // Reset delivery type when cancelling
            error = null
        )
    }

    fun showDeliveryTypeDialog() {
        _state.value = _state.value.copy(showDeliveryTypeDialog = true, selectedDeliveryType = "default", error = null)
        // Reload tariffs when dialog is shown
        loadFixedTypes()
    }

    fun hideDeliveryTypeDialog() {
        _state.value = _state.value.copy(showDeliveryTypeDialog = false, selectedDeliveryType = "default", error = null)
    }

    fun onDeliveryTypeSelected(type: String) {
        _state.value = _state.value.copy(selectedDeliveryType = type, error = null)
    }

    fun onClientPhoneChange(phone: String) {
        _state.value = _state.value.copy(clientPhone = phone, error = null)
    }

    private fun loadFixedTypes() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoadingTariff = true)
            try {
                when (val result = deliveryRepository.getFixedDeliveryTypes()) {
                    is Resource.Success -> {
                        _state.value = _state.value.copy(
                            fixedTypes = result.data ?: emptyMap(),
                            isLoadingTariff = false
                        )
                    }
                    is Resource.Error -> {
                        _state.value = _state.value.copy(
                            fixedTypes = emptyMap(),
                            isLoadingTariff = false
                        )
                    }
                    is Resource.Loading -> {}
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    fixedTypes = emptyMap(),
                    isLoadingTariff = false
                )
            }
        }
    }

    fun proceedToPhoneInput() {
        // Keep selectedDeliveryType, just close the dialog and open phone input
        _state.value = _state.value.copy(showDeliveryTypeDialog = false, error = null)
        showStartDialog()
    }

    fun startDelivery() {
        val phone = _state.value.clientPhone
        if (phone.isBlank()) {
            _state.value = _state.value.copy(error = "Введите номер телефона клиента")
            return
        }

        val deliveryType = _state.value.selectedDeliveryType
        
        android.util.Log.d("HomeViewModel", "=== START DELIVERY ===")
        android.util.Log.d("HomeViewModel", "Phone: $phone")
        android.util.Log.d("HomeViewModel", "Selected deliveryType: $deliveryType")
        android.util.Log.d("HomeViewModel", "FixedTypes: ${_state.value.fixedTypes}")
        android.util.Log.d("HomeViewModel", "======================")

        viewModelScope.launch {
            _state.value = _state.value.copy(isStartingDelivery = true, error = null)

            when (val result = deliveryRepository.createDelivery(phone, deliveryType)) {
                is Resource.Success -> {
                    android.util.Log.d("HomeViewModel", "Delivery created successfully: ${result.data}")
                    _state.value = _state.value.copy(
                        isStartingDelivery = false,
                        showStartDialog = false,
                        showDeliveryTypeDialog = false,
                        selectedDeliveryType = "default",  // Reset after successful creation
                        activeDelivery = result.data
                    )
                }
                is Resource.Error -> {
                    android.util.Log.e("HomeViewModel", "Error creating delivery: ${result.message}")
                    _state.value = _state.value.copy(
                        isStartingDelivery = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }
}
