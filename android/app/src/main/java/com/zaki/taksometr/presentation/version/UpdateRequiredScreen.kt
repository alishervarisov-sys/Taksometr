package com.zaki.taksometr.presentation.version

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zaki.taksometr.BuildConfig
import com.zaki.taksometr.domain.model.AppVersionConfig
import com.zaki.taksometr.presentation.theme.Primary
import com.zaki.taksometr.presentation.theme.PrimaryDark

/**
 * Full-screen blocker shown when the installed app is older than the minimum
 * version required by the admin. There is no way to dismiss it — the courier
 * must install the new build.
 */
@Composable
fun UpdateRequiredScreen(config: AppVersionConfig?) {
    val context = LocalContext.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(Primary, PrimaryDark)
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                Icons.Default.SystemUpdate,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(96.dp)
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "Доступна новая версия",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = config?.message?.takeIf { it.isNotBlank() }
                    ?: "Пожалуйста, обновите приложение, чтобы продолжить работу.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Текущая версия: ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
            )

            if (config?.minVersionName?.isNotBlank() == true) {
                Text(
                    text = "Требуется версия: ${config.minVersionName}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
                )
            }

            Spacer(modifier = Modifier.height(40.dp))

            Button(
                onClick = { openUpdateLink(context, config?.updateUrl) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(14.dp)
            ) {
                Text(
                    text = "Обновить",
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp),
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

private fun openUpdateLink(context: android.content.Context, url: String?) {
    val link = url?.takeIf { it.isNotBlank() }
        ?: "https://zakitaksometr.web.app/"
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    } catch (e: ActivityNotFoundException) {
        // No browser / store app available — nothing more we can do.
    }
}
