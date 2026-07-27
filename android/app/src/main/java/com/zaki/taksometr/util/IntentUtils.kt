package com.zaki.taksometr.util

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/**
 * Helpers for launching external apps from delivery/order cards:
 *  - dialing the client's phone number
 *  - opening turn-by-turn navigation to a pickup / destination point.
 *
 * Navigation uses the standard `geo:` intent so the courier can pick whatever
 * map app they have installed (2GIS, Yandex.Maps, Google Maps ...). We prefer
 * exact coordinates when the order has them and fall back to a free-text
 * address query otherwise.
 */
object IntentUtils {

    /** Opens the phone dialer pre-filled with [phone]. No permission required. */
    fun dialPhone(context: Context, phone: String) {
        val cleaned = phone.trim()
        if (cleaned.isBlank()) return
        try {
            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$cleaned")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "Не удалось открыть набор номера", Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Opens external navigation to a geographic point. When [lat]/[lng] are
     * available they are used directly; otherwise the [label] (address) is used
     * as a search query. Returns false if nothing could be opened.
     */
    fun openNavigation(
        context: Context,
        lat: Double?,
        lng: Double?,
        label: String = ""
    ): Boolean {
        val uri: Uri = when {
            lat != null && lng != null -> {
                val encodedLabel = Uri.encode(label.ifBlank { "$lat,$lng" })
                Uri.parse("geo:$lat,$lng?q=$lat,$lng($encodedLabel)")
            }
            label.isNotBlank() -> Uri.parse("geo:0,0?q=${Uri.encode(label)}")
            else -> return false
        }
        return try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            )
            true
        } catch (e: ActivityNotFoundException) {
            // Fall back to a Google Maps web URL that any browser can open.
            try {
                val web = if (lat != null && lng != null) {
                    "https://www.google.com/maps/dir/?api=1&destination=$lat,$lng"
                } else {
                    "https://www.google.com/maps/search/?api=1&query=${Uri.encode(label)}"
                }
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(web)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                )
                true
            } catch (e2: ActivityNotFoundException) {
                Toast.makeText(context, "Не найдено приложение для навигации", Toast.LENGTH_SHORT).show()
                false
            }
        }
    }
}
