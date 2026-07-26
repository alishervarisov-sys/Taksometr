package com.zaki.taksometr.presentation.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import com.zaki.taksometr.util.ImageUtils

/**
 * Circular courier avatar. Shows the decoded profile photo when [photoBase64]
 * is present, otherwise falls back to the first letter of the name.
 */
@Composable
fun CourierAvatar(
    photoBase64: String?,
    fallbackLetter: String,
    size: Dp,
    letterStyle: TextStyle = MaterialTheme.typography.headlineMedium,
    backgroundColor: Color = MaterialTheme.colorScheme.primary,
    letterColor: Color = MaterialTheme.colorScheme.onPrimary
) {
    val imageBitmap = remember(photoBase64) {
        photoBase64?.let { ImageUtils.decodeBase64ToImageBitmap(it) }
    }

    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(backgroundColor),
        contentAlignment = Alignment.Center
    ) {
        if (imageBitmap != null) {
            Image(
                bitmap = imageBitmap,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape)
            )
        } else {
            Text(
                text = fallbackLetter,
                style = letterStyle,
                color = letterColor
            )
        }
    }
}
