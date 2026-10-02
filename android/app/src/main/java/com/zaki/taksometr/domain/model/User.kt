package com.zaki.taksometr.domain.model

data class User(
    val id: String = "",
    val login: String = "",
    val name: String = "",
    val phone: String = "",
    val city: String = "",
    val role: UserRole = UserRole.COURIER,
    /** Derived busy/online flag (true while the courier has an active delivery). */
    val isOnline: Boolean = false,
    /**
     * Manual "on shift" switch controlled by the courier. When false the courier
     * is off shift and is excluded from new marketplace order distribution and
     * push notifications. Defaults to true for backward compatibility with
     * existing user documents that don't have the field yet.
     */
    val isOnShift: Boolean = true,
    val isBlocked: Boolean = false,
    /** Admin-controlled permission to send balance transfers. */
    val balanceTransferEnabled: Boolean = true,
    val balance: Double = 0.0,
    val createdAt: Long = System.currentTimeMillis(),
    val fcmToken: String = "",
    /** Profile photo stored as a compressed base64 JPEG string (may be empty). */
    val photoBase64: String = "",
    /** Average client rating (1..5). 0 when the courier has no ratings yet. */
    val rating: Double = 0.0,
    /** Number of client ratings the courier has received. */
    val ratingCount: Int = 0,
    val lowBalanceNotificationActive: Boolean = false,
    val lowBalanceNotificationId: String = "",
    val pendingTopUpRequestId: String = "",
    val pendingTopUpAmount: Double = 0.0
)

enum class UserRole {
    ADMIN,
    COURIER
}
