package com.zaki.taksometr.presentation.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Static light values are also used to build the Material color scheme.
val LightCourierCanvas = Color(0xFFF4F8FF)
val LightCourierSky = Color(0xFFEAF4FF)
val LightCourierBlue = Color(0xFF3786F6)
val LightCourierBlueDark = Color(0xFF1E64C8)
val LightCourierBlueSoft = Color(0xFFE8F2FF)
val LightCourierInk = Color(0xFF142B49)
val LightCourierMuted = Color(0xFF70849E)
val LightCourierLine = Color(0xFFDDE9F7)
val LightCourierGreen = Color(0xFF2EAE79)
val LightCourierGreenSoft = Color(0xFFE8F8F0)

data class CourierPalette(
    val canvas: Color,
    val sky: Color,
    val surface: Color,
    val blue: Color,
    val blueDark: Color,
    val blueSoft: Color,
    val ink: Color,
    val muted: Color,
    val line: Color,
    val green: Color,
    val greenSoft: Color,
    val heroBrush: Brush
)

val LightCourierPalette = CourierPalette(
    canvas = LightCourierCanvas,
    sky = LightCourierSky,
    surface = Color.White,
    blue = LightCourierBlue,
    blueDark = LightCourierBlueDark,
    blueSoft = LightCourierBlueSoft,
    ink = LightCourierInk,
    muted = LightCourierMuted,
    line = LightCourierLine,
    green = LightCourierGreen,
    greenSoft = LightCourierGreenSoft,
    heroBrush = Brush.linearGradient(listOf(Color(0xFF438FF8), Color(0xFF2D74DC)))
)

val DarkCourierPalette = CourierPalette(
    canvas = Color(0xFF0D1B2D),
    sky = Color(0xFF172C46),
    surface = Color(0xFF1D3450),
    blue = Color(0xFF286FCE),
    blueDark = Color(0xFFA7D0FF),
    blueSoft = Color(0xFF254468),
    ink = Color(0xFFF2F7FF),
    muted = Color(0xFFB5C7DE),
    line = Color(0xFF3D5977),
    green = Color(0xFF4BD6A3),
    greenSoft = Color(0xFF1C483D),
    heroBrush = Brush.linearGradient(listOf(Color(0xFF286EC7), Color(0xFF1B509C)))
)

val LocalCourierPalette = staticCompositionLocalOf { LightCourierPalette }

val CourierCanvas: Color @Composable get() = LocalCourierPalette.current.canvas
val CourierSky: Color @Composable get() = LocalCourierPalette.current.sky
val CourierSurface: Color @Composable get() = LocalCourierPalette.current.surface
val CourierBlue: Color @Composable get() = LocalCourierPalette.current.blue
val CourierBlueDark: Color @Composable get() = LocalCourierPalette.current.blueDark
val CourierBlueSoft: Color @Composable get() = LocalCourierPalette.current.blueSoft
val CourierInk: Color @Composable get() = LocalCourierPalette.current.ink
val CourierMuted: Color @Composable get() = LocalCourierPalette.current.muted
val CourierLine: Color @Composable get() = LocalCourierPalette.current.line
val CourierGreen: Color @Composable get() = LocalCourierPalette.current.green
val CourierGreenSoft: Color @Composable get() = LocalCourierPalette.current.greenSoft
val CourierHeroBrush: Brush @Composable get() = LocalCourierPalette.current.heroBrush
