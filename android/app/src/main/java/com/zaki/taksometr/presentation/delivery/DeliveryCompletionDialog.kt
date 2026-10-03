package com.zaki.taksometr.presentation.delivery

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import com.zaki.taksometr.domain.model.Delivery
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/** Shared by metered and fixed-price deliveries. Evidence survives a rejected
 * code and Activity recreation, and tracking stops only after server success. */
@Composable
fun DeliveryCompletionDialog(
    delivery: Delivery,
    summary: String,
    isCompleting: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit
) {
    val context = LocalContext.current
    var code by rememberSaveable(delivery.id) { mutableStateOf("") }
    var pendingPhotoPath by rememberSaveable(delivery.id) { mutableStateOf<String?>(null) }
    var photoPath by rememberSaveable(delivery.id) { mutableStateOf<String?>(null) }
    var photoBase64 by remember(delivery.id) { mutableStateOf("") }
    var photoError by remember(delivery.id) { mutableStateOf<String?>(null) }
    var processingPhoto by remember(delivery.id) { mutableStateOf(false) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (success) {
            photoPath?.let { File(it).delete() }
            photoPath = pendingPhotoPath
        } else {
            pendingPhotoPath?.let { File(it).delete() }
        }
        pendingPhotoPath = null
    }
    LaunchedEffect(photoPath) {
        photoBase64 = ""
        photoError = null
        val path = photoPath ?: return@LaunchedEffect
        processingPhoto = true
        try {
            photoBase64 = withContext(Dispatchers.IO) { encodeDeliveryPhoto(File(path)) }
        } catch (e: Exception) {
            photoError = "Не удалось подготовить фото. Сделайте новый снимок."
        } finally {
            processingPhoto = false
        }
    }
    val ready = (!delivery.requiresRecipientCode || code.length == 6) &&
        (!delivery.requiresDeliveryPhoto || photoBase64.isNotEmpty()) && !processingPhoto && !isCompleting

    AlertDialog(
        onDismissRequest = { if (!isCompleting) onDismiss() },
        title = { Text("Завершение заказа") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(summary)
                if (delivery.requiresRecipientCode) {
                    Text("Код подтверждения вручения из SMS получателя")
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it.filter { ch -> ch in '0'..'9' }.take(6) },
                        label = { Text("Код получателя") },
                        supportingText = { Text("Попросите код после передачи заказа получателю") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        enabled = !isCompleting,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (delivery.requiresDeliveryPhoto) {
                    Text("Обязательно фото вручения заказа")
                    photoPath?.let { path ->
                        AsyncImage(model = File(path), contentDescription = "Фото вручения", modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp))
                    }
                    TextButton(enabled = !isCompleting && !processingPhoto, onClick = {
                        try {
                            val directory = File(context.cacheDir, "delivery_photos").apply { mkdirs() }
                            val file = File.createTempFile("handoff_", ".jpg", directory)
                            pendingPhotoPath = file.absolutePath
                            camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.deliveryphotos", file))
                        } catch (e: Exception) {
                            pendingPhotoPath?.let { File(it).delete() }
                            pendingPhotoPath = null
                            photoError = "Не удалось открыть камеру. Проверьте, установлено ли приложение камеры."
                        }
                    }) { Text(if (photoPath == null) "Сделать фото" else "Переснять фото") }
                    if (processingPhoto) CircularProgressIndicator()
                    photoError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
                if (delivery.requiresRecipientCode || delivery.requiresDeliveryPhoto) {
                    Text("Подтверждение проверяется через интернет. До успешной проверки заказ остаётся активным.")
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = ready, onClick = { onConfirm(code, photoBase64) }) {
                Text(if (isCompleting) "Проверка…" else "Завершить заказ")
            }
        },
        dismissButton = { TextButton(enabled = !isCompleting, onClick = onDismiss) { Text("Назад") } }
    )
}

// Resize before encoding so the callable and private Firestore document stay
// small. Strip EXIF (including GPS) and correct orientation in the JPEG pixels.
private fun encodeDeliveryPhoto(file: File): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1280) sample *= 2
    val decoded = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: error("Invalid camera photo")
    val orientation = ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(270f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(270f)
        }
    }
    val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    try {
        var quality = 80
        var bytes: ByteArray
        do {
            bytes = ByteArrayOutputStream().use { output ->
                check(rotated.compress(Bitmap.CompressFormat.JPEG, quality, output))
                output.toByteArray()
            }
            quality -= 10
        } while (bytes.size > 300 * 1024 && quality >= 30)
        require(bytes.size <= 300 * 1024)
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    } finally {
        if (rotated !== decoded) rotated.recycle()
        decoded.recycle()
    }
}
