package io.github.csanadtelbisz.triplo

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val updater by lazy { AppUpdater(this) }
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var photoWriter: PhotoWriter
    private val galleryHandler by lazy { GalleryHandler(applicationContext) }

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileChooserCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileChooserCallback = null
    }

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(APP_HOST)
            .addPathHandler("/native/", galleryHandler)
            .addPathHandler("/", WebAssetHandler(this))
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView = WebView(this)
        configureWebView()
        installBridge()

        // Full-screen WebView: it passes the cutout and system bar insets to the page
        // as env(safe-area-inset-*) and resizes the visual viewport for the keyboard.
        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // The page may own Back first, for example to close the full-screen image.
                webView.evaluateJavascript("window.__triploHandleBack ? window.__triploHandleBack() : false") { handled ->
                    if (handled == "true") return@evaluateJavascript
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })

        webView.loadUrl(shareUrl(intent) ?: "$APP_ORIGIN/")
    }

    override fun onStart() {
        super.onStart()
        updater.checkIfDue()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        shareUrl(intent)?.let { webView.loadUrl(it) }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun installBridge() {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            "This WebView version lacks WEB_MESSAGE_LISTENER; update Android System WebView."
        }
        val googleAuth = GoogleAuth(this)
        val fileSaver = FileSaver(this)
        val galleryPermission = GalleryPermission(this)
        photoWriter = PhotoWriter(this, galleryHandler)
        val bridge = NativeBridge(
            mapOf(
                "googleAuthorize" to NativeBridge.Handler { _, responder -> googleAuth.authorize(responder) },
                "saveFile" to NativeBridge.Handler { args, responder -> fileSaver.save(args, responder) },
                "galleryPermission" to NativeBridge.Handler { _, responder -> galleryPermission.request(responder) },
                "requestPhotoWrite" to NativeBridge.Handler { args, responder -> photoWriter.requestWrite(args, responder) },
            )
        )
        WebViewCompat.addWebMessageListener(webView, "TriploNative", setOf(APP_ORIGIN)) { _, message: WebMessageCompat, _, _, reply ->
            message.data?.let { bridge.onMessage(it, reply) }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) {
            WebViewCompat.addWebMessageListener(webView, "TriploPhotoWriter", setOf(APP_ORIGIN)) { _, message, _, _, reply ->
                photoWriter.saveMessage(message, reply)
            }
        }
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == APP_HOST) return false
                openExternally(request.url)
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // window.open(..., '_blank') goes to the system browser.
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val popup = WebView(view.context)
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        openExternally(request.url)
                        v.post { v.destroy() }
                        return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    fileChooser.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    fileChooserCallback = null
                    false
                }
            }
        }
    }

    // https://csanadtelbisz.github.io/triplo/share/<token> -> the app's own /share/<token> route.
    private fun shareUrl(intent: Intent?): String? {
        val path = intent?.data?.takeIf { intent.action == Intent.ACTION_VIEW }?.encodedPath ?: return null
        val index = path.indexOf(SHARE_PATH)
        return if (index < 0) null else "$APP_ORIGIN$SHARE_PATH${path.substring(index + SHARE_PATH.length)}"
    }

    private fun openExternally(uri: Uri) {
        if (uri.scheme != "https" && uri.scheme != "http") return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
        }
    }

    private companion object {
        const val APP_HOST = "appassets.androidplatform.net"
        const val APP_ORIGIN = "https://$APP_HOST"
        const val SHARE_PATH = "/share/"
    }
}
