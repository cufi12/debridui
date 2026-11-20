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

          var selector = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[tabindex]:not([tabindex="-1"]),[onclick],[data-tv-focusable]';
          var lastFocused = null;
          var lastHorizontalMove = 0;
          var scrollState = null;

          function candidates() {
            return Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function (el) {
              var r = el.getBoundingClientRect();
              var s = window.getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' &&
                s.display !== 'none' && s.opacity !== '0' && !el.disabled &&
                el.getAttribute('aria-hidden') !== 'true' &&
                !el.closest('[aria-hidden="true"],[inert]');
            });
          }

          function center(el) {
            var r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
          }

          function focusElement(el) {
            if (!el) return;
            lastFocused = el;
            try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }

          function directionalTarget(current, direction) {
            var items = candidates();
            if (!items.length) return null;
            if (!current || items.indexOf(current) < 0) return items[0];

            var a = center(current), best = null, bestScore = Infinity;
            items.forEach(function (el) {
              if (el === current) return;
              var b = center(el), dx = b.x - a.x, dy = b.y - a.y;
              var primary = direction === 'left' ? -dx :
                direction === 'right' ? dx : direction === 'up' ? -dy : dy;
              if (primary <= 2) return;

              var horizontal = direction === 'left' || direction === 'right';
              var overlap = horizontal
                ? Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
                : Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
              var secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
              var overlapBonus = overlap > 0 ? Math.min(overlap, 80) * 0.45 : 0;
              var score = primary + secondary * (overlap > 0 ? 0.65 : 2.4) - overlapBonus;
              if (score < bestScore) { bestScore = score; best = el; }
            });
            return best;
          }

          window.__debridTvMoveFocus = function (direction, isRepeat) {
            var active = document.activeElement;
            if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) &&
                !active.readOnly && !active.disabled) return;
            var now = Date.now();
            if (isRepeat && (direction === 'left' || direction === 'right')) {
              if (now - lastHorizontalMove < 85) return;
              lastHorizontalMove = now;
            }
            var current = active && active !== document.body && active !== document.documentElement
              ? active : lastFocused;
            var target = directionalTarget(current, direction);
            if (target) focusElement(target);
          };

          function findScrollHost(el) {
            var node = el;
            while (node && node !== document.body && node !== document.documentElement) {
              var s = window.getComputedStyle(node);
              if (/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight + 8) return node;
              node = node.parentElement;
            }
            return window;
          }

          window.__debridTvFastScroll = function (direction) {
            var active = document.activeElement;
            if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
            var anchor = active && active !== document.body ? active : lastFocused;
            if (!anchor) return;
            if (!scrollState) scrollState = { anchor: anchor, direction: direction, host: findScrollHost(anchor) };
            var host = scrollState.host;
            var amount = host === window ? Math.max(140, window.innerHeight * 0.48) : Math.max(120, host.clientHeight * 0.48);
            var delta = direction === 'down' ? amount : -amount;
            if (host === window) window.scrollBy({ top: delta, behavior: 'smooth' });
            else host.scrollBy({ top: delta, behavior: 'smooth' });
          };

          window.__debridTvFinishScroll = function () {
            if (!scrollState) return;
            var state = scrollState;
            scrollState = null;
            var origin = center(state.anchor);
            var sign = state.direction === 'down' ? 1 : -1;
            var visible = candidates().filter(function (el) {
              var r = el.getBoundingClientRect();
              return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
            });
            var best = null, score = Infinity;
            visible.forEach(function (el) {
              if (el === state.anchor) return;
              var p = center(el), dy = (p.y - origin.y) * sign;
              if (dy < -8) return;
              var value = Math.max(0, dy) + Math.abs(p.x - origin.x) * 1.7;
              if (value < score) { score = value; best = el; }
            });
            if (best) focusElement(best);
          };

          window.__debridTvActivateFocus = function () {
            var active = document.activeElement;
            if (active && active !== document.body && active !== document.documentElement) {
              if (typeof active.click === 'function' && !/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.click();
              return;
            }
            var first = candidates()[0];
            if (first) { focusElement(first); if (typeof first.click === 'function') first.click(); }
          };

          document.addEventListener('focusin', function (event) {
            if (event.target && event.target.matches && event.target.matches(selector)) lastFocused = event.target;
          }, true);

          var style = document.createElement('style');
          style.textContent = [
            ':focus { outline: 3px solid #8b5cf6 !important; outline-offset: 4px !important; border-radius: 8px; box-shadow: 0 0 0 2px rgba(139,92,246,.22) !important; }',
            'a,button,[role=button],[role=link],input,select,textarea,[tabindex] { scroll-margin: 10vh 5vw !important; }',
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
        if (::webView.isInitialized) {
            val direction = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> "left"
                KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
                KeyEvent.KEYCODE_DPAD_UP -> "up"
                KeyEvent.KEYCODE_DPAD_DOWN -> "down"
                else -> null
            }

            if (direction != null && event.action == KeyEvent.ACTION_UP) {
                if (direction == "up" || direction == "down") {
                    webView.evaluateJavascript("window.__debridTvFinishScroll && window.__debridTvFinishScroll();", null)
                }
                return true
            }

            if (direction != null && event.action == KeyEvent.ACTION_DOWN) {
                if ((direction == "up" || direction == "down") && event.repeatCount > 0) {
                    webView.evaluateJavascript("window.__debridTvFastScroll && window.__debridTvFastScroll('$direction');", null)
                } else {
                    val repeat = if (event.repeatCount > 0) "true" else "false"
                    webView.evaluateJavascript("window.__debridTvMoveFocus && window.__debridTvMoveFocus('$direction', $repeat);", null)
                }
                return true
            }

            if (event.action == KeyEvent.ACTION_DOWN &&
                (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
                 event.keyCode == KeyEvent.KEYCODE_ENTER ||
                 event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER)
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
