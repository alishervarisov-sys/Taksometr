package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    suspend fun login(login: String, password: String): Resource<User>
    suspend fun logout()
    fun getCurrentUser(): Flow<User?>
    fun isLoggedIn(): Boolean
    suspend fun updateFcmToken(token: String)
    /** Saves the courier's profile photo (compressed base64 JPEG) to their user document. */
    suspend fun updateProfilePhoto(photoBase64: String): Resource<Unit>
}
