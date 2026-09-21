package com.zaki.taksometr.presentation.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.ui.unit.dp

private val DarkColorScheme = darkColorScheme(
    primary = DarkCourierPalette.blue,
    onPrimary = OnPrimary,
    primaryContainer = Color(0xFF24466E),
    onPrimaryContainer = Color(0xFFE8F2FF),
    secondary = Color(0xFF365A80),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFF24466E),
    background = DarkCourierPalette.canvas,
    surface = DarkCourierPalette.surface,
    onBackground = DarkCourierPalette.ink,
    onSurface = DarkCourierPalette.ink,
    surfaceVariant = DarkCourierPalette.sky,
    onSurfaceVariant = DarkCourierPalette.muted,
    outline = DarkCourierPalette.line,
    outlineVariant = DarkCourierPalette.line
)

private val LightColorScheme = lightColorScheme(
    primary = Primary,
    onPrimary = OnPrimary,
    primaryContainer = LightCourierBlueSoft,
    onPrimaryContainer = LightCourierInk,
    secondary = Secondary,
    onSecondary = OnSecondary,
    secondaryContainer = SecondaryLight,
    background = BackgroundLight,
    surface = SurfaceLight,
    onBackground = LightCourierInk,
    onSurface = LightCourierInk,
    surfaceVariant = LightCourierBlueSoft,
    onSurfaceVariant = LightCourierMuted,
    outline = LightCourierLine,
    outlineVariant = LightCourierLine
)

private val CourierShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp)
)

data class NightModeState(val enabled: Boolean, val onChange: (Boolean) -> Unit)

val LocalNightModeState = staticCompositionLocalOf { NightModeState(false) {} }

@Composable
fun ZaKiTaksometrTheme(
    darkTheme: Boolean = false,
    onDarkThemeChange: (Boolean) -> Unit = {},
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = if (darkTheme) DarkCourierPalette.sky.toArgb() else LightCourierSky.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
            window.navigationBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !darkTheme
        }
    }

    CompositionLocalProvider(
        LocalCourierPalette provides if (darkTheme) DarkCourierPalette else LightCourierPalette,
        LocalNightModeState provides NightModeState(darkTheme, onDarkThemeChange)
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            shapes = CourierShapes,
            content = content
        )
    }
}
