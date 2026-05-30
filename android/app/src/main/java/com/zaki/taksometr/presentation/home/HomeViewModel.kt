package com.zaki.taksometr.presentation.home

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
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
    val error: String? = null
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val deliveryRepository: DeliveryRepository,
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
    }

    private fun loadUserData() {
        viewModelScope.launch {
            authRepository.getCurrentUser().collect { user ->
                _state.value = _state.value.copy(user = user)
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
        _state.value = _state.value.copy(showStartDialog = false, clientPhone = "", error = null)
    }

    fun onClientPhoneChange(phone: String) {
        _state.value = _state.value.copy(clientPhone = phone, error = null)
    }

    fun startDelivery() {
        val phone = _state.value.clientPhone
        if (phone.isBlank()) {
            _state.value = _state.value.copy(error = "Введите номер телефона клиента")
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(isStartingDelivery = true, error = null)

            when (val result = deliveryRepository.createDelivery(phone)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        isStartingDelivery = false,
                        showStartDialog = false,
                        activeDelivery = result.data
                    )
                }
                is Resource.Error -> {
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
