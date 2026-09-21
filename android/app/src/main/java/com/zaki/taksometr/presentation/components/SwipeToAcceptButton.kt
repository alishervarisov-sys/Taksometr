package com.zaki.taksometr.presentation.components

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardDoubleArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Slide-to-accept control. The courier drags the thumb to the right edge to
 * confirm accepting the order. This replaces a plain "accept" button so the
 * action is deliberate and hard to trigger by accident.
 *
 * @param isAccepting shows a spinner and locks the control while the request runs.
 * @param onAccept invoked once when the thumb is dragged past the threshold.
 * @param accentColor color of the thumb and progress trail.
 */
@Composable
fun SwipeToAcceptButton(
    isAccepting: Boolean,
    onAccept: () -> Unit,
    modifier: Modifier = Modifier,
    idleText: String = "Свайпните вправо, чтобы принять",
    acceptingText: String = "Принятие заказа...",
    accentColor: Color = MaterialTheme.colorScheme.primary,
    onAccentColor: Color = MaterialTheme.colorScheme.onPrimary,
    labelColor: Color = MaterialTheme.colorScheme.onSurface
) {
    val density = LocalDensity.current
    val trackHeight = 56.dp
    val thumbSize = 48.dp
    val edgePaddingPx = with(density) { 4.dp.toPx() }
    val thumbSizePx = with(density) { thumbSize.toPx() }

    var trackWidthPx by remember { mutableStateOf(0f) }
    val offsetX = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var triggered by remember { mutableStateOf(false) }

    val maxOffset = (trackWidthPx - thumbSizePx - edgePaddingPx * 2f).coerceAtLeast(0f)
    val progress = if (maxOffset > 0f) (offsetX.value / maxOffset).coerceIn(0f, 1f) else 0f

    // If the request finished (success or failure) reset the thumb.
    LaunchedEffect(isAccepting) {
        if (!isAccepting && triggered) {
            triggered = false
            offsetX.animateTo(0f)
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(trackHeight)
            .clip(RoundedCornerShape(28.dp))
            .background(accentColor.copy(alpha = 0.12f))
            .onSizeChanged { trackWidthPx = it.width.toFloat() }
            .draggable(
                orientation = Orientation.Horizontal,
                enabled = !isAccepting && !triggered,
                state = rememberDraggableState { delta ->
                    scope.launch {
                        offsetX.snapTo((offsetX.value + delta).coerceIn(0f, maxOffset))
                    }
                },
                onDragStopped = {
                    if (maxOffset > 0f && offsetX.value >= maxOffset * 0.85f) {
                        triggered = true
                        offsetX.animateTo(maxOffset)
                        onAccept()
                    } else {
                        offsetX.animateTo(0f)
                    }
                }
            ),
        contentAlignment = Alignment.CenterStart
    ) {
        // Progress trail that grows behind the thumb.
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .width(with(density) { (offsetX.value + thumbSizePx + edgePaddingPx).toDp() })
                .clip(RoundedCornerShape(28.dp))
                .background(accentColor.copy(alpha = 0.22f))
        )

        Text(
            text = if (isAccepting) acceptingText else idleText,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = thumbSize + 8.dp, end = 12.dp)
                .alpha(1f - progress),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = labelColor
        )

        Box(
            modifier = Modifier
                .offset { IntOffset((offsetX.value + edgePaddingPx).roundToInt(), 0) }
                .size(thumbSize)
                .clip(CircleShape)
                .background(accentColor),
            contentAlignment = Alignment.Center
        ) {
            if (isAccepting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                    color = onAccentColor
                )
            } else {
                Icon(
                    Icons.Default.KeyboardDoubleArrowRight,
                    contentDescription = "Принять заказ",
                    tint = onAccentColor,
                    modifier = Modifier.size(26.dp)
                )
            }
        }
    }
}
