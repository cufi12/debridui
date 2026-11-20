package com.debridui.tv

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

// TV wrapper with directional-key focus navigation for Android TV remotes.
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val appUrl = "https://debridui.onrender.com"

    private val tvNavigationScript = """
        (function () {
          if (window.__debridTvNavigationInstalled) return;
          window.__debridTvNavigationInstalled = true;

          var selector = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex="-1"]),[onclick]';

          function candidates() {
            return Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function (el) {
              var r = el.getBoundingClientRect();
              var s = window.getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' &&
                s.display !== 'none' && s.opacity !== '0' && !el.disabled &&
                el.getAttribute('aria-hidden') !== 'true';
            });
          }

          function focusElement(el) {
            if (!el) return;
            try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }

          window.__debridTvMoveFocus = function (direction) {
            var items = candidates();
            if (!items.length) return;

            var active = document.activeElement;
            if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
            var current = active && items.indexOf(active) >= 0 ? active :
              (active && active.closest ? active.closest(selector) : null);

            if (!current || items.indexOf(current) < 0) {
              focusElement(items[0]);
              return;
            }

            var a = current.getBoundingClientRect();
            var ax = a.left + a.width / 2;
            var ay = a.top + a.height / 2;
            var best = null;
            var bestScore = Infinity;

            items.forEach(function (el) {
              if (el === current) return;
              var r = el.getBoundingClientRect();
              var dx = (r.left + r.width / 2) - ax;
              var dy = (r.top + r.height / 2) - ay;
              var primary, secondary;

              if (direction === 'left') { primary = -dx; secondary = Math.abs(dy); }
              else if (direction === 'right') { primary = dx; secondary = Math.abs(dy); }
              else if (direction === 'up') { primary = -dy; secondary = Math.abs(dx); }
              else { primary = dy; secondary = Math.abs(dx); }

              if (primary <= 2) return;
              var score = primary + secondary * 2.2;
              if (score < bestScore) { bestScore = score; best = el; }
            });

            if (best) focusElement(best);
          };

          window.__debridTvActivateFocus = function () {
            var active = document.activeElement;
            if (active && active !== document.body && active !== document.documentElement) {
              if (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
                active.focus();
              } else if (typeof active.click === 'function') {
                active.click();
              }
              return;
            }
            var first = candidates()[0];
            if (first) { focusElement(first); if (typeof first.click === 'function') first.click(); }
          };

          var style = document.createElement('style');
          style.textContent = [
            ':focus { outline: 3px solid #7c3aed !important; outline-offset: 3px !important; }',
            'button,a,[role=button],[role=link],input,select,textarea,[tabindex] { scroll-margin: 110px !important; }',
            'html { scroll-behavior: smooth; }'
          ].join(' ');
          (document.head || document.documentElement).appendChild(style);
        })();
    """.trimIndent()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
            descendantFocusability = ViewGroupCompat.AFTER_DESCENDANTS
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadsImagesAutomatically = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return openOrKeep(request.url)
                }

                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return openOrKeep(Uri.parse(url))
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    view.evaluateJavascript(tvNavigationScript, null)
                }
            }
        }
        setContentView(webView)
        webView.requestFocus()
        if (savedInstanceState == null) webView.loadUrl(appUrl)
        else webView.restoreState(savedInstanceState)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && ::webView.isInitialized) {
            val direction = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> "left"
                KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
                KeyEvent.KEYCODE_DPAD_UP -> "up"
                KeyEvent.KEYCODE_DPAD_DOWN -> "down"
                else -> null
            }

            if (direction != null) {
                webView.evaluateJavascript(
                    "window.__debridTvMoveFocus && window.__debridTvMoveFocus('$direction');",
                    null
                )
                return true
            }

            if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
            ) {
                webView.evaluateJavascript(
                    "window.__debridTvActivateFocus && window.__debridTvActivateFocus();",
                    null
                )
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun openOrKeep(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme == "https" || scheme == "http") return false
        try {
            val intent = if (scheme == "intent") {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
            } else {
                Intent(Intent.ACTION_VIEW, uri)
            }
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Keine passende App installiert (z. B. VLC).", Toast.LENGTH_LONG).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Link konnte nicht geöffnet werden.", Toast.LENGTH_LONG).show()
        }
        return true
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    private object ViewGroupCompat {
        const val AFTER_DESCENDANTS = 0x40000
    }
}
