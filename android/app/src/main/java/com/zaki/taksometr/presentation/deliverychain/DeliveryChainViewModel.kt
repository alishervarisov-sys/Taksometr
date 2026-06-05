package com.zaki.taksometr.presentation.deliverychain

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.ChainDeliveryItem
import com.zaki.taksometr.domain.model.DeliveryChain
import com.zaki.taksometr.domain.repository.DeliveryChainRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DeliveryChainState(
    val currentChain: DeliveryChain? = null,
    val draftChains: List<DeliveryChain> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val showAddItemDialog: Boolean = false,
    val clientPhone: String = "",
    val orderNumber: String = "",
    val selectedDeliveryType: String = "default",
    val fixedTypes: Map<String, Double> = emptyMap(),
    val showDeliveryTypeDialog: Boolean = false
)

@HiltViewModel
class DeliveryChainViewModel @Inject constructor(
    private val chainRepository: DeliveryChainRepository,
    private val deliveryRepository: DeliveryRepository,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(DeliveryChainState())
    val state: StateFlow<DeliveryChainState> = _state.asStateFlow()

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    init {
        observeActiveChain()
        loadDraftChains()
        loadFixedTypes()
    }

    private fun observeActiveChain() {
        viewModelScope.launch {
            chainRepository.getActiveChain(userId).collect { chain ->
                _state.value = _state.value.copy(currentChain = chain)
            }
        }
    }

    private fun loadDraftChains() {
        viewModelScope.launch {
            chainRepository.getDraftChains(userId).collect { chains ->
                _state.value = _state.value.copy(draftChains = chains)
            }
        }
    }

    private fun loadFixedTypes() {
        viewModelScope.launch {
            when (val result = deliveryRepository.getFixedDeliveryTypes()) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        fixedTypes = result.data ?: emptyMap()
                    )
                }
                else -> {}
            }
        }
    }

    fun createNewChain() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.createChain()) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        currentChain = result.data
                    )
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }

    fun showAddItemDialog() {
        _state.value = _state.value.copy(
            showAddItemDialog = true,
            clientPhone = "",
            orderNumber = "",
            selectedDeliveryType = "default",
            error = null
        )
    }

    fun hideAddItemDialog() {
        _state.value = _state.value.copy(
            showAddItemDialog = false,
            clientPhone = "",
            orderNumber = "",
            selectedDeliveryType = "default",
            error = null
        )
    }

    fun showDeliveryTypeDialog() {
        _state.value = _state.value.copy(showDeliveryTypeDialog = true)
    }

    fun hideDeliveryTypeDialog() {
        _state.value = _state.value.copy(showDeliveryTypeDialog = false)
    }

    fun onDeliveryTypeSelected(type: String) {
        _state.value = _state.value.copy(
            selectedDeliveryType = type,
            showDeliveryTypeDialog = false,
            showAddItemDialog = true
        )
    }

    fun onClientPhoneChange(phone: String) {
        _state.value = _state.value.copy(clientPhone = phone, error = null)
    }

    fun onOrderNumberChange(number: String) {
        _state.value = _state.value.copy(orderNumber = number, error = null)
    }

    fun addItemToChain() {
        val chainId = _state.value.currentChain?.id ?: return
        val phone = _state.value.clientPhone
        val orderNum = _state.value.orderNumber
        val deliveryType = _state.value.selectedDeliveryType

        if (phone.isBlank()) {
            _state.value = _state.value.copy(error = "Введите номер телефона")
            return
        }
        if (orderNum.isBlank()) {
            _state.value = _state.value.copy(error = "Введите номер заказа")
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.addItemToChain(chainId, phone, orderNum, deliveryType)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        showAddItemDialog = false,
                        clientPhone = "",
                        orderNumber = "",
                        selectedDeliveryType = "default"
                    )
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }

    fun removeItem(itemId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.removeItemFromChain(itemId)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(isLoading = false)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }

    fun moveItem(items: List<ChainDeliveryItem>) {
        viewModelScope.launch {
            chainRepository.updateSequenceOrder(items)
        }
    }

    fun startChain() {
        val chainId = _state.value.currentChain?.id ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.startChain(chainId)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(isLoading = false)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }

    fun completeCurrentAndMoveNext(waitingMinutes: Double = 0.0) {
        val chainId = _state.value.currentChain?.id ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.completeCurrentAndMoveNext(chainId, waitingMinutes)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(isLoading = false)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }

    fun cancelChain() {
        val chainId = _state.value.currentChain?.id ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.cancelChain(chainId)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        currentChain = null
                    )
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }

    fun loadChain(chainId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            when (val result = chainRepository.getChainById(chainId)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        currentChain = result.data
                    )
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                else -> {}
            }
        }
    }
}
