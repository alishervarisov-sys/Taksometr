package com.zaki.taksometr.presentation

import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.compose.rememberNavController
import com.zaki.taksometr.domain.repository.AuthRepository
import com.zaki.taksometr.domain.model.UserRole
import com.zaki.taksometr.presentation.navigation.NavGraph
import com.zaki.taksometr.presentation.navigation.Screen
import com.zaki.taksometr.presentation.theme.ZaKiTaksometrTheme
import com.zaki.taksometr.presentation.version.AppVersionViewModel
import com.zaki.taksometr.presentation.version.UpdateRequiredScreen
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocalizationManager
import dagger.hilt.android.AndroidEntryPoint
import java.util.Locale
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var authRepository: AuthRepository

    private val appVersionViewModel: AppVersionViewModel by viewModels()

    override fun attachBaseContext(newBase: Context) {
        val prefs = newBase.getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE)
        val language = LocalizationManager.getCurrentLanguage(prefs)
        val locale = when (language) {
            LocalizationManager.Language.TAJIK -> Locale("tg")
            LocalizationManager.Language.RUSSIAN -> Locale("ru")
            LocalizationManager.Language.ENGLISH -> Locale("en")
        }
        
        val config = Configuration(newBase.resources.configuration)
        config.setLocale(locale)
        val context = newBase.createConfigurationContext(config)
        super.attachBaseContext(context)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        setContent {
            val prefs = getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE)
            val currentLanguageCode = remember {
                mutableStateOf(LocalizationManager.getCurrentLanguage(prefs).code)
            }
            var nightMode by rememberSaveable { mutableStateOf(prefs.getBoolean("night_mode", false)) }
            val appVersionState by appVersionViewModel.state.collectAsState()

            ZaKiTaksometrTheme(
                darkTheme = nightMode,
                onDarkThemeChange = { enabled ->
                    nightMode = enabled
                    prefs.edit().putBoolean("night_mode", enabled).apply()
                }
            ) {
                com.zaki.taksometr.util.ProvideLanguage(currentLanguageCode.value) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background
                    ) {
                        if (appVersionState.updateRequired) {
                            UpdateRequiredScreen(config = appVersionState.config)
                        } else {
                            val navController = rememberNavController()
                            val startDestination = when {
                                !authRepository.isLoggedIn() -> Screen.Auth.route
                                authRepository.getSavedUserRole() == UserRole.ADMIN -> Screen.AdminPanel.route
                                else -> Screen.Home.route
                            }

                            NavGraph(
                                navController = navController,
                                startDestination = startDestination
                            )
                        }
                    }
                }
            }
        }
    }
}
