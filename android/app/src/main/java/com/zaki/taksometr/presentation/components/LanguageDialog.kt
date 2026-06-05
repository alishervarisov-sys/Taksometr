package com.zaki.taksometr.presentation.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocalizationManager

@Composable
fun LanguageDialog(
    currentLanguage: LocalizationManager.Language,
    onDismiss: () -> Unit,
    onLanguageSelected: (LocalizationManager.Language) -> Unit
) {
    var selectedLanguage by remember { mutableStateOf(currentLanguage) }
    val context = LocalContext.current

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = when (selectedLanguage) {
                    LocalizationManager.Language.TAJIK -> "Забон / Язык / Language"
                    LocalizationManager.Language.RUSSIAN -> "Язык / Забон / Language"
                    LocalizationManager.Language.ENGLISH -> "Language / Язык / Забон"
                }
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                LocalizationManager.Language.values().forEach { language ->
                    LanguageOptionCompact(
                        language = language,
                        isSelected = selectedLanguage == language,
                        onClick = { selectedLanguage = language }
                    )
                    if (language != LocalizationManager.Language.values().last()) {
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val prefs = context.getSharedPreferences(Constants.PREFS_NAME, android.content.Context.MODE_PRIVATE)
                    LocalizationManager.setLanguage(prefs, selectedLanguage)
                    LocalizationManager.setLanguageSelected(prefs)
                    onLanguageSelected(selectedLanguage)
                    onDismiss()
                }
            ) {
                Text(
                    when (selectedLanguage) {
                        LocalizationManager.Language.TAJIK -> "Тасдиқ кардан"
                        LocalizationManager.Language.RUSSIAN -> "Применить"
                        LocalizationManager.Language.ENGLISH -> "Apply"
                    }
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(
                    when (selectedLanguage) {
                        LocalizationManager.Language.TAJIK -> "Бекор кардан"
                        LocalizationManager.Language.RUSSIAN -> "Отмена"
                        LocalizationManager.Language.ENGLISH -> "Cancel"
                    }
                )
            }
        }
    )
}

@Composable
fun LanguageOptionCompact(
    language: LocalizationManager.Language,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            RadioButton(
                selected = isSelected,
                onClick = onClick
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = language.displayName,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                modifier = Modifier.weight(1f)
            )
            if (isSelected) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}
