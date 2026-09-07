package com.zaki.taksometr.presentation.profile

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.model.Delivery
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.repository.DeliveryRepository
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.ImageUtils
import com.zaki.taksometr.util.Resource
import com.google.firebase.functions.FirebaseFunctions
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.tasks.await
import java.util.Calendar
import java.util.UUID
import javax.inject.Inject

/** Aggregated stats for a single calendar day. */
data class DailyStat(
    val dayStartMillis: Long,
    val deliveryCount: Int,
    val totalEarnings: Double
)

data class TransferRecipient(
    val id: String,
    val name: String,
    val phone: String
)

data class ProfileState(
    val user: User? = null,
    val deliveries: List<Delivery> = emptyList(),
    val dailyStats: List<DailyStat> = emptyList(),
    val totalDeliveries: Int = 0,
    val totalEarnings: Double = 0.0,
    val todayDeliveries: Int = 0,
    val todayEarnings: Double = 0.0,
    val isLoading: Boolean = true,
    val isUploadingPhoto: Boolean = false,
    val photoError: String? = null,
    val transferRecipients: List<TransferRecipient> = emptyList(),
    val transferCity: String = "",
    val isLoadingTransferRecipients: Boolean = false,
    val isTransferring: Boolean = false,
    val transferError: String? = null,
    val transferSuccess: String? = null
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authRepository: AuthRepository,
    private val deliveryRepository: DeliveryRepository,
    private val functions: FirebaseFunctions,
    private val prefs: SharedPreferences
) : ViewModel() {

    private val _state = MutableStateFlow(ProfileState())
    val state: StateFlow<ProfileState> = _state.asStateFlow()

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    private var pendingTransferRequestId: String? = null
    private var pendingTransferRecipientId: String? = null
    private var pendingTransferAmount: Double? = null

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

    fun onPhotoSelected(uri: Uri) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isUploadingPhoto = true, photoError = null)

            val base64 = withContext(Dispatchers.IO) {
                ImageUtils.uriToCompressedBase64(context, uri)
            }

            if (base64 == null) {
                _state.value = _state.value.copy(
                    isUploadingPhoto = false,
                    photoError = "Не удалось обработать изображение"
                )
                return@launch
            }

            when (val result = authRepository.updateProfilePhoto(base64)) {
                is Resource.Success -> {
                    // The user flow (getCurrentUser) will emit the updated photo.
                    _state.value = _state.value.copy(isUploadingPhoto = false)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(
                        isUploadingPhoto = false,
                        photoError = result.message
                    )
                }
                is Resource.Loading -> Unit
            }
        }
    }

    fun clearPhotoError() {
        _state.value = _state.value.copy(photoError = null)
    }

    fun loadTransferRecipients() {
        if (_state.value.isLoadingTransferRecipients) return
        viewModelScope.launch {
            _state.value = _state.value.copy(
                isLoadingTransferRecipients = true,
                transferError = null,
                transferSuccess = null
            )
            try {
                val result = functions
                    .getHttpsCallable("getBalanceTransferRecipients")
                    .call(mapOf("senderId" to userId))
                    .await()
                @Suppress("UNCHECKED_CAST")
                val payload = result.data as? Map<String, Any?> ?: emptyMap()
                val recipients = (payload["recipients"] as? List<*>)
                    .orEmpty()
                    .mapNotNull { item ->
                        val row = item as? Map<*, *> ?: return@mapNotNull null
                        val id = row["id"] as? String ?: return@mapNotNull null
                        TransferRecipient(
                            id = id,
                            name = row["name"] as? String ?: "Курьер",
                            phone = row["phone"] as? String ?: ""
                        )
                    }
                _state.value = _state.value.copy(
                    transferRecipients = recipients,
                    transferCity = payload["city"] as? String ?: ""
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    transferError = e.message ?: "Не удалось загрузить курьеров"
                )
            } finally {
                _state.value = _state.value.copy(isLoadingTransferRecipients = false)
            }
        }
    }

    fun transferBalance(recipientId: String, amountText: String) {
        if (_state.value.isTransferring) return
        val amount = amountText.trim().replace(',', '.').toDoubleOrNull()
        if (amount == null) {
            _state.value = _state.value.copy(
                transferError = "Минимальная сумма перевода — 10 сомони"
            )
            return
        }
        when {
            recipientId.isBlank() -> {
                _state.value = _state.value.copy(transferError = "Выберите курьера")
                return
            }
            amount < 10.0 -> {
                _state.value = _state.value.copy(
                    transferError = "Минимальная сумма перевода — 10 сомони"
                )
                return
            }
            kotlin.math.abs(amount * 100.0 - kotlin.math.round(amount * 100.0)) > 0.000001 -> {
                _state.value = _state.value.copy(
                    transferError = "Укажите не более двух знаков после запятой"
                )
                return
            }
            amount > (_state.value.user?.balance ?: 0.0) -> {
                _state.value = _state.value.copy(transferError = "Недостаточно средств на балансе")
                return
            }
        }

        val requestId = if (
            pendingTransferRecipientId == recipientId &&
            pendingTransferAmount == amount &&
            pendingTransferRequestId != null
        ) {
            pendingTransferRequestId!!
        } else {
            UUID.randomUUID().toString().also {
                pendingTransferRequestId = it
                pendingTransferRecipientId = recipientId
                pendingTransferAmount = amount
            }
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(
                isTransferring = true,
                transferError = null,
                transferSuccess = null
            )
            try {
                functions.getHttpsCallable("transferCourierBalance")
                    .call(
                        mapOf(
                            "senderId" to userId,
                            "recipientId" to recipientId,
                            "amount" to amount,
                            "requestId" to requestId
                        )
                    )
                    .await()
                pendingTransferRequestId = null
                pendingTransferRecipientId = null
                pendingTransferAmount = null
                val recipientName = _state.value.transferRecipients
                    .firstOrNull { it.id == recipientId }
                    ?.name ?: "курьеру"
                _state.value = _state.value.copy(
                    transferSuccess = "Перевод ${formatTransferAmount(amount)} сомони отправлен: $recipientName"
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    transferError = e.message ?: "Не удалось выполнить перевод"
                )
            } finally {
                _state.value = _state.value.copy(isTransferring = false)
            }
        }
    }

    fun clearTransferMessage() {
        _state.value = _state.value.copy(transferError = null, transferSuccess = null)
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

    private fun formatTransferAmount(amount: Double): String =
        if (amount % 1.0 == 0.0) amount.toLong().toString() else String.format("%.2f", amount)
}
