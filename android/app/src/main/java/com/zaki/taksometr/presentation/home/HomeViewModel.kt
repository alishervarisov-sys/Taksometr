package com.zaki.taksometr.presentation.home

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.messaging.FirebaseMessaging
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.domain.repository.LocationRepository
import com.zaki.taksometr.domain.repository.TodayStats
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PendingMarketplaceOrder(
    val id: String = "",
    val clientPhone: String = "",
    val comment: String = "",
    val pickupAddress: String = "",
    val destinationAddress: String = "",
    val createdAt: Long = 0L
)

data class WinnerAnnouncement(
    val id: String = "",
    val winnerId: String = "",
    val winnerName: String = "",
    val congratsText: String = "",
    val shortText: String = "",
    val prizeAmount: Double = 0.0,
    val orderCount: Int = 0,
    val expiresAt: Long = 0L,
    // True when the current courier is the winner (show full congratulation).
    val isWinner: Boolean = false
)

data class HomeState(
    val user: User? = null,
    val todayStats: TodayStats = TodayStats(),
    val activeDelivery: Delivery? = null,
    val activeCount: Int = 0,
    val pendingMarketplaceOrders: List<PendingMarketplaceOrder> = emptyList(),
    val isAcceptingMarketplaceOrder: Boolean = false,
    val clientPhone: String = "",
    val isStartingDelivery: Boolean = false,
    val showStartDialog: Boolean = false,
    val showDeliveryTypeDialog: Boolean = false,
    val selectedDeliveryType: String = "default",
    val fixedTypes: Map<String, Double> = emptyMap(),
    val isLoadingTariff: Boolean = false,
    val isBlocked: Boolean = false,
    val winnerAnnouncement: WinnerAnnouncement? = null,
    val showWinnerDialog: Boolean = false,
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

    private var userLoaded = false
    private var pendingOrderListener: ListenerRegistration? = null
    private var winnerListener: ListenerRegistration? = null

    init {
        loadUserData()
        loadTodayStats()
        observeActiveDelivery()
        loadFixedTypes()
        clearStaleActiveDeliveryOnStart()
        refreshFcmToken()
    }

    private fun refreshFcmToken() {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            if (token.isNotEmpty()) {
                viewModelScope.launch { authRepository.updateFcmToken(token) }
            }
        }
    }

    private fun clearStaleActiveDeliveryOnStart() {
        viewModelScope.launch {
            deliveryRepository.clearStaleActiveDelivery()
        }
    }

    private fun loadUserData() {
        viewModelScope.launch {
            authRepository.getCurrentUser().collect { user ->
                if (user == null && userLoaded) {
                    _state.value = _state.value.copy(user = null, isBlocked = true)
                    pendingOrderListener?.remove()
                    pendingOrderListener = null
                } else if (user?.isBlocked == true) {
                    _state.value = _state.value.copy(user = user, isBlocked = true)
                    pendingOrderListener?.remove()
                    pendingOrderListener = null
                    authRepository.logout()
                } else {
                    _state.value = _state.value.copy(user = user, isBlocked = false)
                    if (user != null && pendingOrderListener == null) {
                        observePendingMarketplaceOrders(user.id)
                    }
                    if (user != null && winnerListener == null) {
                        observeWinnerAnnouncement(user.id)
                    }
                }
                if (user != null) userLoaded = true
            }
        }
    }

    private fun observePendingMarketplaceOrders(courierId: String) {
        pendingOrderListener?.remove()
        pendingOrderListener = FirebaseFirestore.getInstance()
            .collection("deliveries")
            .whereEqualTo("status", "PENDING")
            .whereEqualTo("orderKind", "MARKETPLACE")
            .whereArrayContains("availableCourierIds", courierId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    android.util.Log.e("HomeViewModel", "Pending orders listener error", error)
                    return@addSnapshotListener
                }
                if (_state.value.activeCount >= Constants.MAX_CONCURRENT_DELIVERIES) {
                    _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
                    return@addSnapshotListener
                }
                val orders = snapshot?.documents
                    ?.filter { it.id != deliveryRepository.getCurrentActiveDeliveryId() }
                    ?.mapNotNull { doc ->
                    val pickup = doc.get("pickup") as? Map<*, *>
                    val destination = doc.get("destination") as? Map<*, *>
                    PendingMarketplaceOrder(
                        id = doc.id,
                        clientPhone = doc.getString("clientPhone") ?: "",
                        comment = doc.getString("comment") ?: "",
                        pickupAddress = pickup?.get("address") as? String ?: "",
                        destinationAddress = destination?.get("address") as? String ?: "",
                        createdAt = doc.getLong("createdAt") ?: 0L
                    )
                } ?: emptyList()
                if (orders.isNotEmpty()) {
                    prefs.edit().putString(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID, orders.first().id).apply()
                } else {
                    prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
                }
                _state.value = _state.value.copy(pendingMarketplaceOrders = orders)
            }
    }

    private fun loadPendingMarketplaceOrderFromPrefsFallback(courierId: String) {
        val pendingId = prefs.getString(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID, null) ?: run {
            _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
            return
        }

        if (_state.value.activeDelivery != null) {
            prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
            _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
            return
        }

        FirebaseFirestore.getInstance().collection("deliveries").document(pendingId)
            .get()
            .addOnSuccessListener { doc ->
                if (!doc.exists()) {
                    prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
                    _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
                    return@addOnSuccessListener
                }

                if (doc.getString("status") != "PENDING" || doc.getString("orderKind") != "MARKETPLACE") {
                    prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
                    _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
                    return@addOnSuccessListener
                }

                val availableCourierIds = (doc.get("availableCourierIds") as? List<*>)
                    ?.mapNotNull { it as? String }
                    ?: emptyList()
                if (availableCourierIds.isNotEmpty() && !availableCourierIds.contains(courierId)) {
                    prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
                    _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
                    return@addOnSuccessListener
                }

                val pickup = doc.get("pickup") as? Map<*, *>
                val destination = doc.get("destination") as? Map<*, *>
                _state.value = _state.value.copy(
                    pendingMarketplaceOrders = listOf(PendingMarketplaceOrder(
                        id = doc.id,
                        clientPhone = doc.getString("clientPhone") ?: "",
                        comment = doc.getString("comment") ?: "",
                        pickupAddress = pickup?.get("address") as? String ?: "",
                        destinationAddress = destination?.get("address") as? String ?: "",
                        createdAt = doc.getLong("createdAt") ?: 0L
                    ))
                )
            }
            .addOnFailureListener {
                _state.value = _state.value.copy(pendingMarketplaceOrders = emptyList())
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
        viewModelScope.launch {
            deliveryRepository.getActiveDeliveries().collect { list ->
                _state.value = _state.value.copy(activeCount = list.size)
            }
        }
    }

    fun acceptPendingMarketplaceOrder(orderId: String) {
        val pending = _state.value.pendingMarketplaceOrders.firstOrNull { it.id == orderId } ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isAcceptingMarketplaceOrder = true, error = null)
            when (val result = deliveryRepository.acceptMarketplaceDelivery(pending.id)) {
                is Resource.Success -> {
                    prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
                    _state.value = _state.value.copy(
                        isAcceptingMarketplaceOrder = false,
                        pendingMarketplaceOrders = emptyList(),
                        activeDelivery = result.data
                    )
                }
                is Resource.Error -> {
                    prefs.edit().remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID).apply()
                    val message = result.message ?: "Заказ уже принял другой курьер"
                    _state.value = _state.value.copy(
                        isAcceptingMarketplaceOrder = false,
                        error = if (message.contains("Accepted by:")) "Заказ уже принял другой курьер" else message,
                        pendingMarketplaceOrders = emptyList()
                    )
                }
                is Resource.Loading -> Unit
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
            selectedDeliveryType = "default",
            error = null
        )
    }

    fun showDeliveryTypeDialog() {
        _state.value = _state.value.copy(showDeliveryTypeDialog = true, selectedDeliveryType = "default", error = null)
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
                    is Resource.Loading -> Unit
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

        viewModelScope.launch {
            _state.value = _state.value.copy(isStartingDelivery = true, error = null)

            when (val result = deliveryRepository.createDelivery(phone, deliveryType)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(
                        isStartingDelivery = false,
                        showStartDialog = false,
                        showDeliveryTypeDialog = false,
                        selectedDeliveryType = "default",
                        activeDelivery = result.data
                    )
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isStartingDelivery = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> Unit
            }
        }
    }

    fun syncRemoteActiveDelivery() {
        viewModelScope.launch {
            when (val result = deliveryRepository.syncRemoteActiveDelivery()) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(activeDelivery = result.data)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(error = result.message)
                }
                is Resource.Loading -> Unit
            }
        }
    }

    /**
     * Observe the "winner of the month" announcements in real time. Shows the
     * congratulation dialog for the most recent, still-active announcement that
     * the courier has not dismissed yet. The winner sees the full personal
     * congratulation; everyone else sees the short summary.
     */
    private fun observeWinnerAnnouncement(courierId: String) {
        winnerListener?.remove()
        winnerListener = FirebaseFirestore.getInstance()
            .collection(Constants.COLLECTION_WINNER_ANNOUNCEMENTS)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(1)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    android.util.Log.e("HomeViewModel", "Winner listener error", error)
                    return@addSnapshotListener
                }
                val doc = snapshot?.documents?.firstOrNull()
                if (doc == null) {
                    _state.value = _state.value.copy(winnerAnnouncement = null, showWinnerDialog = false)
                    return@addSnapshotListener
                }

                val expiresAt = doc.getLong("expiresAt") ?: 0L
                // Ignore expired announcements.
                if (expiresAt in 1 until System.currentTimeMillis()) {
                    _state.value = _state.value.copy(winnerAnnouncement = null, showWinnerDialog = false)
                    return@addSnapshotListener
                }

                val winnerId = doc.getString("winnerId") ?: ""
                val announcement = WinnerAnnouncement(
                    id = doc.id,
                    winnerId = winnerId,
                    winnerName = doc.getString("winnerName") ?: "",
                    congratsText = doc.getString("congratsText") ?: "",
                    shortText = doc.getString("shortText") ?: "",
                    prizeAmount = doc.getDouble("prizeAmount") ?: 0.0,
                    orderCount = (doc.getLong("orderCount") ?: 0L).toInt(),
                    expiresAt = expiresAt,
                    isWinner = winnerId == courierId
                )

                val lastSeenId = prefs.getString(Constants.PREF_LAST_SEEN_WINNER_ANNOUNCEMENT_ID, "")
                val shouldShow = announcement.id != lastSeenId
                _state.value = _state.value.copy(
                    winnerAnnouncement = announcement,
                    showWinnerDialog = shouldShow
                )
            }
    }

    fun dismissWinnerDialog() {
        val id = _state.value.winnerAnnouncement?.id
        if (!id.isNullOrEmpty()) {
            prefs.edit().putString(Constants.PREF_LAST_SEEN_WINNER_ANNOUNCEMENT_ID, id).apply()
        }
        _state.value = _state.value.copy(showWinnerDialog = false)
    }

    fun logout() {
        viewModelScope.launch {
            pendingOrderListener?.remove()
            pendingOrderListener = null
            winnerListener?.remove()
            winnerListener = null
            authRepository.logout()
        }
    }

    override fun onCleared() {
        pendingOrderListener?.remove()
        pendingOrderListener = null
        winnerListener?.remove()
        winnerListener = null
        super.onCleared()
    }
}
