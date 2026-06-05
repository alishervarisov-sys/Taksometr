package com.zaki.taksometr.util

import androidx.compose.runtime.Composable

// Simple helper to get string by current language
@Composable
fun str(key: Map<String, String>): String {
    val lang = LocalLanguage.current
    return key[lang] ?: key["en"] ?: ""
}
