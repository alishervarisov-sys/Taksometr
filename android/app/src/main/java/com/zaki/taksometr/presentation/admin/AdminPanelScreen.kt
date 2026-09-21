package com.zaki.taksometr.presentation.admin

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import com.zaki.taksometr.presentation.theme.CourierCanvas
import com.zaki.taksometr.presentation.theme.CourierSky
import com.zaki.taksometr.presentation.theme.CourierInk
import com.zaki.taksometr.presentation.theme.CourierBlueDark
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay
import org.json.JSONObject

private const val ADMIN_PANEL_URL = "https://zakitaksometr.web.app/"
private const val ADMIN_PANEL_HOST = "zakitaksometr.web.app"
private const val ADMIN_ASSET_ROOT = "admin"

private fun mimeTypeFor(path: String): String = when (path.substringAfterLast('.', "")) {
    "html" -> "text/html"
    "js" -> "application/javascript"
    "css" -> "text/css"
    "json" -> "application/json"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "svg" -> "image/svg+xml"
    "webp" -> "image/webp"
    "woff" -> "font/woff"
    "woff2" -> "font/woff2"
    else -> "application/octet-stream"
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AdminPanelScreen(
    onLogout: () -> Unit,
    viewModel: AdminPanelViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val adminId = viewModel.adminId
    var webView by remember { mutableStateOf<WebView?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var sessionReady by remember { mutableStateOf(false) }
    var canGoBack by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isLoggingOut by remember { mutableStateOf(false) }

    fun logout() {
        if (isLoggingOut) return
        isLoggingOut = true
        webView?.evaluateJavascript(
            "localStorage.removeItem('adminId'); localStorage.removeItem('adminRole');",
            null
        )
        viewModel.logout(onLogout)
    }

    BackHandler(enabled = canGoBack) {
        webView?.goBack()
    }

    // The web panel owns its logout button. Mirror that action into the native
    // session so reopening the APK never silently signs the admin back in.
    LaunchedEffect(sessionReady, webView) {
        val currentWebView = webView ?: return@LaunchedEffect
        while (sessionReady) {
            delay(750)
            currentWebView.evaluateJavascript("localStorage.getItem('adminId')") { value ->
                if (value == "null") logout()
            }
        }
    }

    // Keep this effect stable. Keying it by webView destroys the newly created
    // instance during the first recomposition (null -> WebView), leaving the
    // loading indicator on screen forever.
    DisposableEffect(Unit) {
        onDispose {
            webView?.apply {
                stopLoading()
                webViewClient = WebViewClient()
                destroy()
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(
            color = CourierSky,
            tonalElevation = 0.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "ZaKi Admin",
                    color = CourierInk,
                    style = MaterialTheme.typography.titleLarge
                )
                Spacer(modifier = Modifier.weight(1f))
                IconButton(
                    onClick = {
                        errorMessage = null
                        isLoading = true
                        webView?.reload()
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Обновить",
                        tint = CourierBlueDark
                    )
                }
                IconButton(onClick = ::logout) {
                    Icon(
                        imageVector = Icons.Default.Logout,
                        contentDescription = "Выйти",
                        tint = CourierBlueDark
                    )
                }
            }
        }

        if (adminId.isNullOrBlank()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.padding(24.dp)
                ) {
                    Text("Сессия администратора не найдена")
                    androidx.compose.material3.Button(onClick = ::logout) {
                        Text("Вернуться ко входу")
                    }
                }
            }
            return@Column
        }

        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { webContext ->
                    WebView(webContext).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.databaseEnabled = true
                        // Keep HTTP resources and Firestore's IndexedDB storage
                        // available across app restarts. LOAD_DEFAULT still
                        // validates online resources and receives fresh data.
                        settings.cacheMode = WebSettings.LOAD_DEFAULT
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        settings.setSupportZoom(true)
                        settings.builtInZoomControls = true
                        settings.displayZoomControls = false

                        webViewClient = object : WebViewClient() {
                            private var sessionInjected = false

                            override fun shouldInterceptRequest(
                                view: WebView,
                                request: WebResourceRequest
                            ): WebResourceResponse? {
                                if (request.method != "GET" || request.url.host != ADMIN_PANEL_HOST) {
                                    return null
                                }

                                val requestedPath = request.url.path.orEmpty().trimStart('/')
                                val localPath = when {
                                    requestedPath.isBlank() -> "index.html"
                                    // BrowserRouter routes are served by index.html.
                                    !requestedPath.substringAfterLast('/').contains('.') -> "index.html"
                                    else -> requestedPath
                                }

                                return try {
                                    val stream = context.assets.open("$ADMIN_ASSET_ROOT/$localPath")
                                    WebResourceResponse(mimeTypeFor(localPath), null, stream)
                                } catch (_: Exception) {
                                    // Files not bundled in the APK (for example an APK download
                                    // hosted on Firebase) continue through the network normally.
                                    null
                                }
                            }

                            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                                isLoading = true
                                errorMessage = null
                                canGoBack = view.canGoBack()
                            }

                            override fun onPageFinished(view: WebView, url: String?) {
                                canGoBack = view.canGoBack()
                                val uri = url?.let(Uri::parse)
                                if (uri?.host != ADMIN_PANEL_HOST) {
                                    isLoading = false
                                    return
                                }

                                if (!sessionInjected) {
                                    sessionInjected = true
                                    val quotedAdminId = JSONObject.quote(adminId)
                                    view.evaluateJavascript(
                                        """
                                        localStorage.setItem('adminId', $quotedAdminId);
                                        localStorage.setItem('adminRole', 'ADMIN');
                                        """.trimIndent(),
                                    ) {
                                        // Reload only after localStorage has been written so the
                                        // React app sees the authenticated session on startup.
                                        view.loadUrl(ADMIN_PANEL_URL)
                                    }
                                } else {
                                    sessionReady = true
                                    isLoading = false
                                }
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView,
                                request: WebResourceRequest
                            ): Boolean {
                                val uri = request.url
                                if (uri.host == ADMIN_PANEL_HOST) return false
                                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                return true
                            }

                            override fun onReceivedError(
                                view: WebView,
                                request: WebResourceRequest,
                                error: WebResourceError
                            ) {
                                if (request.isForMainFrame) {
                                    isLoading = false
                                    errorMessage = "Не удалось загрузить админ-панель. Проверьте интернет."
                                }
                            }
                        }

                        webView = this
                        loadUrl(ADMIN_PANEL_URL)
                    }
                }
            )

            if (isLoading) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
            }

            errorMessage?.let { message ->
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        modifier = Modifier.padding(24.dp)
                    ) {
                        Spacer(modifier = Modifier.weight(1f))
                        Text(text = message)
                        androidx.compose.material3.Button(
                            onClick = {
                                errorMessage = null
                                isLoading = true
                                webView?.reload()
                            }
                        ) {
                            Text("Повторить")
                        }
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}
