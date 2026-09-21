package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.AppVersionConfig
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.model.UserRole
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    suspend fun login(login: String, password: String): Resource<User>
    suspend fun logout()
    fun getCurrentUser(): Flow<User?>
    fun isLoggedIn(): Boolean
    fun getSavedUserId(): String?
    fun getSavedUserRole(): UserRole?
    suspend fun updateFcmToken(token: String)
    /** Saves the courier's profile photo (compressed base64 JPEG) to their user document. */
    suspend fun updateProfilePhoto(photoBase64: String): Resource<Unit>
    /** Sets the courier's manual "on shift" flag on their user document. */
    suspend fun setOnShift(isOnShift: Boolean): Resource<Unit>
    /** Reports the installed app version to the courier's user document. */
    suspend fun reportAppVersion(versionCode: Int, versionName: String)
    /** Observes the admin-configured minimum required app version. */
    fun observeAppVersionConfig(): Flow<AppVersionConfig?>
}
