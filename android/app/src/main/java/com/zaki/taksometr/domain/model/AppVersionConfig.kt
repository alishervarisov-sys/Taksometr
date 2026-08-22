package com.zaki.taksometr.domain.model

/**
 * Minimum required app version configured by the admin in `settings/appVersion`.
 * When [enabled] and the installed app's version code is below [minVersionCode],
 * the courier sees a full-screen "please update" screen.
 */
data class AppVersionConfig(
    val minVersionCode: Int = 0,
    val minVersionName: String = "",
    val enabled: Boolean = false,
    val message: String = "",
    val updateUrl: String = ""
)
