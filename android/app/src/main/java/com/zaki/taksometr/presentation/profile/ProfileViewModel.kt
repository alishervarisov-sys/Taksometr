package com.zaki.taksometr.presentation.profile

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

/** Aggregated stats for a single calendar day. */
data class DailyStat(
    val dayStartMillis: Long,
    val deliveryCount: Int,
    val totalEarnings: Double
)

data class ProfileState(
    val user: User? = null,
    val deliveries: List<Delivery> = emptyList(),
    val dailyStats: List<DailyStat> = emptyList(),
    val totalDeliveries: Int = 0,
    val totalEarnings: Double = 0.0,
    val todayDeliveries: Int = 0,
    val todayEarnings: Double = 0.0,
    val isLoading: Boolean = true
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val deliveryRepository: DeliveryRepository,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(ProfileState())
    val state: StateFlow<ProfileState> = _state.asStateFlow()

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    init {
        loadUser()
        loadHistory()
    }

    private fun loadUser() {
        viewModelScope.launch {
            authRepository.getCurrentUser().collect { user ->
                _state.value = _state.value.copy(user = user)
            }
        }
    }

    private fun loadHistory() {
        viewModelScope.launch {
            deliveryRepository.getDeliveryHistory(userId).collect { deliveries ->
                // Only completed deliveries count toward earnings/analytics.
                val completed = deliveries.filter { it.status == DeliveryStatus.COMPLETED }

                val todayStart = startOfDay(System.currentTimeMillis())
                val todayList = completed.filter { it.createdAt >= todayStart }

                val dailyStats = completed
                    .groupBy { startOfDay(it.createdAt) }
                    .map { (dayStart, dayDeliveries) ->
                        DailyStat(
                            dayStartMillis = dayStart,
                            deliveryCount = dayDeliveries.size,
                            totalEarnings = dayDeliveries.sumOf { it.cost }
                        )
                    }
                    .sortedByDescending { it.dayStartMillis }

                _state.value = _state.value.copy(
                    deliveries = deliveries,
                    dailyStats = dailyStats,
                    totalDeliveries = completed.size,
                    totalEarnings = completed.sumOf { it.cost },
                    todayDeliveries = todayList.size,
                    todayEarnings = todayList.sumOf { it.cost },
                    isLoading = false
                )
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }

    private fun startOfDay(millis: Long): Long {
        return Calendar.getInstance().apply {
            timeInMillis = millis
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
    }
}
