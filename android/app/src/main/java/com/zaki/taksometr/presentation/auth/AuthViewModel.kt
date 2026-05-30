package com.zaki.taksometr.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.util.Resource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthState(
    val login: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isSuccess: Boolean = false
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    fun onLoginChange(login: String) {
        _state.value = _state.value.copy(login = login, error = null)
    }

    fun onPasswordChange(password: String) {
        _state.value = _state.value.copy(password = password, error = null)
    }

    fun login() {
        val currentState = _state.value
        if (currentState.login.isBlank() || currentState.password.isBlank()) {
            _state.value = currentState.copy(error = "Заполните все поля")
            return
        }

        viewModelScope.launch {
            _state.value = currentState.copy(isLoading = true, error = null)

            when (val result = authRepository.login(currentState.login, currentState.password)) {
                is Resource.Success -> {
                    _state.value = _state.value.copy(isLoading = false, isSuccess = true)
                }
                is Resource.Error -> {
                    _state.value = _state.value.copy(isLoading = false, error = result.message)
                }
                is Resource.Loading -> {}
            }
        }
    }
}
