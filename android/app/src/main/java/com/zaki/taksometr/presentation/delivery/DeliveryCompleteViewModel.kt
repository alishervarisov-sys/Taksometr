package com.zaki.taksometr.presentation.delivery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DeliveryCompleteState(
    val delivery: Delivery? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class DeliveryCompleteViewModel @Inject constructor(
    private val deliveryRepository: DeliveryRepository
) : ViewModel() {

    private val _state = MutableStateFlow(DeliveryCompleteState())
    val state: StateFlow<DeliveryCompleteState> = _state.asStateFlow()

    fun loadDelivery(deliveryId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            when (val result = deliveryRepository.getDeliveryById(deliveryId)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        delivery = result.data,
                        isLoading = false
                    )
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        error = result.message,
                        isLoading = false
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }
}
