package com.zaki.taksometr.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

// Composition local for current language
val LocalLanguage = compositionLocalOf { "tg" }

@Composable
fun ProvideLanguage(
    languageCode: String,
    content: @Composable () -> Unit
) {
    CompositionLocalProvider(LocalLanguage provides languageCode) {
        content()
    }
}

// Helper composable to get localized string
@Composable
fun stringResource(key: Map<String, String>): String {
    val languageCode = LocalLanguage.current
    return remember(languageCode, key) {
        Strings.get(key, languageCode)
    }
}
