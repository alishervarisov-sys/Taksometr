package com.zaki.taksometr.presentation.version

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zaki.taksometr.BuildConfig
import com.zaki.taksometr.domain.model.AppVersionConfig
import com.zaki.taksometr.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AppVersionState(
    val updateRequired: Boolean = false,
    val config: AppVersionConfig? = null
)

@HiltViewModel
class AppVersionViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _state = MutableStateFlow(AppVersionState())
    val state: StateFlow<AppVersionState> = _state.asStateFlow()

    init {
        // Report the installed version so the admin panel can see who is on an
        // outdated build (best-effort, only when logged in).
        viewModelScope.launch {
            authRepository.reportAppVersion(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)
        }
        // Watch the admin-configured minimum version and block the screen when
        // this build is older than required.
        viewModelScope.launch {
            authRepository.observeAppVersionConfig().collect { config ->
                val cfg = config ?: AppVersionConfig()
                val required = cfg.enabled && BuildConfig.VERSION_CODE < cfg.minVersionCode
                _state.value = AppVersionState(updateRequired = required, config = cfg)
            }
        }
    }
}
