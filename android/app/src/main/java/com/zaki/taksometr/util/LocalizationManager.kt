package com.zaki.taksometr.util

import android.content.Context
import android.content.SharedPreferences

object LocalizationManager {
    private const val PREF_LANGUAGE = "app_language"
    private const val PREF_LANGUAGE_SELECTED = "language_selected"
    
    enum class Language(val code: String, val displayName: String) {
        TAJIK("tg", "Тоҷикӣ"),
        RUSSIAN("ru", "Русский"),
        ENGLISH("en", "English")
    }
    
    fun isLanguageSelected(prefs: SharedPreferences): Boolean {
        return prefs.getBoolean(PREF_LANGUAGE_SELECTED, false)
    }
    
    fun setLanguageSelected(prefs: SharedPreferences) {
        prefs.edit().putBoolean(PREF_LANGUAGE_SELECTED, true).apply()
    }
    
    fun getCurrentLanguage(prefs: SharedPreferences): Language {
        val code = prefs.getString(PREF_LANGUAGE, Language.TAJIK.code) ?: Language.TAJIK.code
        return Language.values().find { it.code == code } ?: Language.TAJIK
    }
    
    fun setLanguage(prefs: SharedPreferences, language: Language) {
        prefs.edit().putString(PREF_LANGUAGE, language.code).apply()
    }
}
