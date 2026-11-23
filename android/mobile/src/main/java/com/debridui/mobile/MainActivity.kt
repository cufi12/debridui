package com.debridui.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * Touch-first DebridUI wrapper for Android phones.
 * Authentication stays on the same HTTPS origin and WebView cookie storage is enabled.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(12, 12, 12)
        window.navigationBarColor = Color.BLACK

        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(12, 12, 12))
            isFocusable = true
            isFocusableInTouchMode = true

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                loadsImagesAutomatically = true
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                allowFileAccess = false
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = true
            }

            cookies.setAcceptThirdPartyCookies(this, true)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean = openExternalScheme(request.url)

                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                    openExternalScheme(Uri.parse(url))

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    cookies.flush()
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    super.onReceivedError(view, request, error)
                    if (request.isForMainFrame) {
                        Toast.makeText(
                            this@MainActivity,
                            "Verbindung fehlgeschlagen. Bitte Internetverbindung prüfen.",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
        }

        setContentView(webView)
        if (savedInstanceState == null) {
            webView.loadUrl("https://debridui.onrender.com/login")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun openExternalScheme(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme == "https" || scheme == "http") return false

        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Keine passende App zum Öffnen des Links gefunden.", Toast.LENGTH_LONG).show()
            true
        } catch (_: Exception) {
            true
        }
    }

    @Deprecated("Deprecated by Android; retained for compatibility with older devices")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}
