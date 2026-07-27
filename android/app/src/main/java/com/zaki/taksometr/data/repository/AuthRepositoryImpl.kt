package com.zaki.taksometr.data.repository

import android.content.SharedPreferences
import com.google.firebase.firestore.FirebaseFirestore
import com.zaki.taksometr.domain.model.User
import com.zaki.taksometr.domain.model.UserRole
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val prefs: SharedPreferences
) : AuthRepository {

    override suspend fun login(login: String, password: String): Resource<User> {
        return try {
            val hashedPassword = hashPassword(password)
            val snapshot = firestore.collection(Constants.COLLECTION_USERS)
                .whereEqualTo("login", login)
                .whereEqualTo("passwordHash", hashedPassword)
                .get()
                .await()

            if (snapshot.isEmpty) {
                return Resource.Error("Неверный логин или пароль")
            }

            val doc = snapshot.documents.first()
            val user = User(
                id = doc.id,
                login = doc.getString("login") ?: "",
                name = doc.getString("name") ?: "",
                phone = doc.getString("phone") ?: "",
                role = UserRole.valueOf(doc.getString("role") ?: "COURIER"),
                isOnline = doc.getBoolean("isOnline") ?: false,
                isOnShift = doc.getBoolean("isOnShift") ?: true,
                isBlocked = doc.getBoolean("isBlocked") ?: false,
                balance = doc.getDouble("balance") ?: 0.0,
                createdAt = doc.getLong("createdAt") ?: 0L,
                fcmToken = doc.getString("fcmToken") ?: "",
                photoBase64 = doc.getString("photoBase64") ?: "",
                rating = doc.getDouble("rating") ?: 0.0,
                ratingCount = (doc.getLong("ratingCount") ?: 0L).toInt()
            )

            if (user.isBlocked) {
                return Resource.Error("Аккаунт заблокирован. Обратитесь к администратору.")
            }

            // Save session
            prefs.edit()
                .putString(Constants.PREF_USER_ID, user.id)
                .putString(Constants.PREF_USER_NAME, user.name)
                .putBoolean(Constants.PREF_IS_LOGGED_IN, true)
                .apply()

            Resource.Success(user)
        } catch (e: Exception) {
            Resource.Error("Ошибка входа: ${e.localizedMessage}")
        }
    }

    override suspend fun logout() {
        prefs.edit()
            .remove(Constants.PREF_USER_ID)
            .putBoolean(Constants.PREF_IS_LOGGED_IN, false)
            .remove(Constants.PREF_ACTIVE_DELIVERY_ID)
            .remove(Constants.PREF_PENDING_MARKETPLACE_DELIVERY_ID)
            .apply()
    }

    override fun getCurrentUser(): Flow<User?> = callbackFlow {
        val userId = prefs.getString(Constants.PREF_USER_ID, null)
        if (userId == null) {
            trySend(null)
            close()
            return@callbackFlow
        }

        val listener = firestore.collection(Constants.COLLECTION_USERS)
            .document(userId)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null || !snapshot.exists()) {
                    trySend(null)
                    return@addSnapshotListener
                }

                val user = User(
                    id = snapshot.id,
                    login = snapshot.getString("login") ?: "",
                    name = snapshot.getString("name") ?: "",
                    phone = snapshot.getString("phone") ?: "",
                    role = UserRole.valueOf(snapshot.getString("role") ?: "COURIER"),
                    isOnline = snapshot.getBoolean("isOnline") ?: false,
                    isOnShift = snapshot.getBoolean("isOnShift") ?: true,
                    isBlocked = snapshot.getBoolean("isBlocked") ?: false,
                    balance = snapshot.getDouble("balance") ?: 0.0,
                    createdAt = snapshot.getLong("createdAt") ?: 0L,
                    fcmToken = snapshot.getString("fcmToken") ?: "",
                    photoBase64 = snapshot.getString("photoBase64") ?: "",
                    rating = snapshot.getDouble("rating") ?: 0.0,
                    ratingCount = (snapshot.getLong("ratingCount") ?: 0L).toInt()
                )
                trySend(user)
            }

        awaitClose { listener.remove() }
    }

    override fun isLoggedIn(): Boolean {
        return prefs.getBoolean(Constants.PREF_IS_LOGGED_IN, false)
    }

    override suspend fun updateFcmToken(token: String) {
        val userId = prefs.getString(Constants.PREF_USER_ID, null) ?: return
        firestore.collection(Constants.COLLECTION_USERS)
            .document(userId)
            .update("fcmToken", token)
            .await()
    }

    override suspend fun updateProfilePhoto(photoBase64: String): Resource<Unit> {
        val userId = prefs.getString(Constants.PREF_USER_ID, null)
            ?: return Resource.Error("Пользователь не найден")
        return try {
            firestore.collection(Constants.COLLECTION_USERS)
                .document(userId)
                .update("photoBase64", photoBase64)
                .await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error("Не удалось сохранить фото: ${e.localizedMessage}")
        }
    }

    override suspend fun setOnShift(isOnShift: Boolean): Resource<Unit> {
        val userId = prefs.getString(Constants.PREF_USER_ID, null)
            ?: return Resource.Error("Пользователь не найден")
        return try {
            firestore.collection(Constants.COLLECTION_USERS)
                .document(userId)
                .update("isOnShift", isOnShift)
                .await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error("Не удалось изменить статус смены: ${e.localizedMessage}")
        }
    }

    private fun hashPassword(password: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(password.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }
}
