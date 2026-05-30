package com.zaki.taksometr.domain.model

data class User(
    val id: String = "",
    val login: String = "",
    val name: String = "",
    val phone: String = "",
    val role: UserRole = UserRole.COURIER,
    val isOnline: Boolean = false,
    val isBlocked: Boolean = false,
    val balance: Double = 0.0,
    val createdAt: Long = System.currentTimeMillis(),
    val fcmToken: String = ""
)

enum class UserRole {
    ADMIN,
    COURIER
}
