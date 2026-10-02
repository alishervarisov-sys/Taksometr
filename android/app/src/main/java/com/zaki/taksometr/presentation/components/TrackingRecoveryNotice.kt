package com.zaki.taksometr.presentation.components

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.zaki.taksometr.service.TrackingController
import com.zaki.taksometr.util.Strings
import com.zaki.taksometr.util.str

/** Background access is optional; ordinary user-started tracking remains available. */
@Composable
fun TrackingRecoveryNotice(trackingNeeded: Boolean) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val pending by TrackingController.pending.collectAsState()
    var backgroundGranted by remember { mutableStateOf(TrackingController.hasBackgroundLocation(context)) }
    var dismissed by rememberSaveable { mutableStateOf(false) }
    var showExplanation by rememberSaveable { mutableStateOf(false) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                backgroundGranted = TrackingController.hasBackgroundLocation(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    if (!trackingNeeded) return
    if (pending.isNotEmpty()) {
        Text(str(Strings.trackingRecoveryInAppMessage), modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            color = MaterialTheme.colorScheme.error)
        TextButton(onClick = { TrackingController.restore(context) }) { Text(str(Strings.trackingRetry)) }
    }
    if (!backgroundGranted && !dismissed && TrackingController.hasLocation(context)) {
        TextButton(onClick = { showExplanation = true }) { Text(str(Strings.backgroundTrackingTitle)) }
    }
    if (showExplanation) {
        AlertDialog(
            onDismissRequest = { showExplanation = false },
            title = { Text(str(Strings.backgroundTrackingTitle)) },
            text = { Column { Text(str(Strings.backgroundTrackingMessage)) } },
            confirmButton = {
                TextButton(onClick = {
                    showExplanation = false
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:${context.packageName}")))
                }) { Text(str(Strings.trackingSettings)) }
            },
            dismissButton = {
                TextButton(onClick = { dismissed = true; showExplanation = false }) { Text(str(Strings.trackingLater)) }
            }
        )
    }
}
