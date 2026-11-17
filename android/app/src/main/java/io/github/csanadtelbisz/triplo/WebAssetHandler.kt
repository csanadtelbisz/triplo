package io.github.csanadtelbisz.triplo

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Serves the bundled web build from assets/web. Paths without a file extension
 * (for example /share/<token>) fall back to index.html, like the 404.html
 * redirect does on GitHub Pages.
 */
class WebAssetHandler(private val context: Context) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse {
        val name = path.trimStart('/').ifEmpty { "index.html" }
        if (name.split('/').any { it == ".." }) return notFound()

        var resolvedName = name
        var stream = open(name)
        if (stream == null && !name.substringAfterLast('/').contains('.')) {
            resolvedName = "index.html"
            stream = open(resolvedName)
        }
        if (stream == null) return notFound()

        val mime = mimeType(resolvedName)
        val encoding = if (mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript")) "utf-8" else null
        return WebResourceResponse(mime, encoding, stream)
    }

    private fun open(name: String): InputStream? = try {
        context.assets.open("web/$name")
    } catch (_: IOException) {
        null
    }

    private fun notFound() =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun mimeType(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "map", "webmanifest" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "wasm" -> "application/wasm"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }
}
