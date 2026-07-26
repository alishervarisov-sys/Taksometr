package com.zaki.taksometr.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.ByteArrayOutputStream

object ImageUtils {

    /**
     * Reads an image from [uri], downscales it so its largest side is at most
     * [maxSize] px, compresses it to JPEG at [quality], and returns a base64
     * (NO_WRAP) string suitable for storing in a Firestore field.
     *
     * Returns null if the image could not be read/decoded.
     */
    fun uriToCompressedBase64(
        context: Context,
        uri: Uri,
        maxSize: Int = 512,
        quality: Int = 70
    ): String? {
        return try {
            val bitmap = context.contentResolver.openInputStream(uri)?.use { input ->
                BitmapFactory.decodeStream(input)
            } ?: return null

            val scaled = scaleDown(bitmap, maxSize)
            val output = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, output)
            if (scaled != bitmap) scaled.recycle()
            bitmap.recycle()
            Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            null
        }
    }

    /** Decodes a base64 (NO_WRAP) JPEG string into an [ImageBitmap], or null on failure. */
    fun decodeBase64ToImageBitmap(base64: String): ImageBitmap? {
        if (base64.isBlank()) return null
        return try {
            val bytes = Base64.decode(base64, Base64.NO_WRAP)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        } catch (e: Exception) {
            null
        }
    }

    private fun scaleDown(bitmap: Bitmap, maxSize: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= maxSize && height <= maxSize) return bitmap
        val ratio = minOf(maxSize.toFloat() / width, maxSize.toFloat() / height)
        val newWidth = (width * ratio).toInt().coerceAtLeast(1)
        val newHeight = (height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }
}
