package com.zaki.taksometr.presentation.history

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.*
import javax.inject.Inject

data class HistoryState(
    val deliveries: List<Delivery> = emptyList(),
    val searchQuery: String = "",
    val startDate: Long? = null,
    val endDate: Long? = null,
    val isLoading: Boolean = false
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val deliveryRepository: DeliveryRepository,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(HistoryState())
    val state: StateFlow<HistoryState> = _state.asStateFlow()

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    init {
        loadHistory()
    }

    private fun loadHistory() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            deliveryRepository.getDeliveryHistory(userId).collect { deliveries ->
                _state.value = _state.value.copy(
                    deliveries = deliveries,
                    isLoading = false
                )
            }
        }
    }

    fun onSearchQueryChange(query: String) {
        _state.value = _state.value.copy(searchQuery = query)
        if (query.isNotBlank()) {
            viewModelScope.launch {
                deliveryRepository.searchDeliveries(query).collect { deliveries ->
                    _state.value = _state.value.copy(deliveries = deliveries)
                }
            }
        } else {
            loadHistory()
        }
    }

    fun filterByDateRange(startDate: Long, endDate: Long) {
        _state.value = _state.value.copy(startDate = startDate, endDate = endDate)
        viewModelScope.launch {
            deliveryRepository.getDeliveriesByDateRange(startDate, endDate).collect { deliveries ->
                _state.value = _state.value.copy(deliveries = deliveries)
            }
        }
    }

    fun clearFilters() {
        _state.value = _state.value.copy(searchQuery = "", startDate = null, endDate = null)
        loadHistory()
    }
}
