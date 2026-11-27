package io.github.csanadtelbisz.triplo

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import android.webkit.WebResourceResponse
import androidx.exifinterface.media.ExifInterface
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.Optional
import java.util.concurrent.ConcurrentHashMap

/**
 * Serves gallery data to the page under /native/:
 *   query/<fromMs>/<toMs>  JSON list of geotagged photos taken in the period
 *   thumb/<id>/<size>      JPEG thumbnail
 *   full/<id>              the photo
 */
class GalleryHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
    private class Metadata(val lat: Double?, val lon: Double?, val label: String?, val offset: String?)

    // MediaStore ids are stable, so GPS and EXIF time are read once per photo.
    private val metadataCache = ConcurrentHashMap<Long, Optional<Metadata>>()

    fun invalidateMetadata(id: Long) { metadataCache.remove(id) }

    override fun handle(path: String): WebResourceResponse {
        val parts = path.split('/')
        return try {
            when (parts.getOrNull(0)) {
                "query" -> bytes(
                    "application/json",
                    query(parts[1].toLong(), parts[2].toLong()).toByteArray(),
                    mapOf("Cache-Control" to "no-store"),
                )
                "thumb" -> thumbnail(parts[1].toLong(), parts.getOrNull(2)?.toIntOrNull() ?: DEFAULT_THUMBNAIL_SIZE)
                "full" -> full(parts[1].toLong())
                "original" -> original(parts[1].toLong())
                else -> status(404)
            }
        } catch (_: SecurityException) {
            status(403)
        } catch (_: IOException) {
            status(404)
        } catch (_: Exception) {
            status(500)
        }
    }

    private fun query(fromMs: Long, toMs: Long): String {
        val result = JSONArray()
        val pathColumn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Images.Media.RELATIVE_PATH else MediaStore.Images.Media.DATA
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.ORIENTATION,
            MediaStore.Images.Media.DISPLAY_NAME,
            pathColumn,
        )
        val selection = "${MediaStore.Images.Media.DATE_TAKEN} >= ? AND ${MediaStore.Images.Media.DATE_TAKEN} <= ?"
        val cursor = context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            arrayOf(fromMs.toString(), toMs.toString()),
            "${MediaStore.Images.Media.DATE_TAKEN} ASC",
        ) ?: return result.toString()
        cursor.use {
            while (it.moveToNext()) {
                val id = it.getLong(0)
                val metadata = metadata(id) ?: continue
                // MediaStore reports the stored pixel size, so swap it for sideways photos.
                val sideways = it.getInt(4) % 180 != 0
                val screenshot = "${it.getString(5).orEmpty()} ${it.getString(6).orEmpty()}".contains("screenshot", ignoreCase = true)
                result.put(
                    JSONObject()
                        .put("id", id)
                        .put("taken", it.getLong(1))
                        .put("width", if (sideways) it.getInt(3) else it.getInt(2))
                        .put("height", if (sideways) it.getInt(2) else it.getInt(3))
                        .put("lat", metadata.lat ?: JSONObject.NULL)
                        .put("lon", metadata.lon ?: JSONObject.NULL)
                        .put("label", metadata.label ?: JSONObject.NULL)
                        .put("offset", metadata.offset ?: JSONObject.NULL)
                        .put("screenshot", screenshot)
                        .put("name", it.getString(5).orEmpty())
                )
            }
        }
        return result.toString()
    }

    private fun metadata(id: Long): Metadata? =
        metadataCache.getOrPut(id) { Optional.ofNullable(readMetadata(id)) }.orElse(null)

    private fun readMetadata(id: Long): Metadata? {
        var uri = imageUri(id)
        // Android hides GPS in EXIF unless the original file is requested (needs ACCESS_MEDIA_LOCATION).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) uri = MediaStore.setRequireOriginal(uri)
        return try {
            context.contentResolver.openInputStream(uri)?.use { stream ->
                val exif = ExifInterface(stream)
                val position = exif.latLong
                Metadata(
                    position?.get(0),
                    position?.get(1),
                    exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) ?: exif.getAttribute(ExifInterface.TAG_DATETIME),
                    exif.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL) ?: exif.getAttribute(ExifInterface.TAG_OFFSET_TIME),
                )
            }
        } catch (_: IOException) {
            null
        } catch (_: UnsupportedOperationException) {
            null
        }
    }

    private fun thumbnail(id: Long, size: Int): WebResourceResponse {
        val uri = imageUri(id)
        // The system thumbnail provider is only reliable for small sizes, so larger ones are decoded here.
        val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && size <= SYSTEM_THUMBNAIL_MAX_SIZE) {
            context.contentResolver.loadThumbnail(uri, Size(size, size), null)
        } else {
            decodeSampled(uri, size)
        }
        return bytes("image/jpeg", jpeg(bitmap))
    }

    private fun full(id: Long): WebResourceResponse {
        val uri = imageUri(id)
        val type = context.contentResolver.getType(uri)
        if (type != null && type in WEB_IMAGE_TYPES) {
            val stream = context.contentResolver.openInputStream(uri) ?: return status(404)
            return WebResourceResponse(type, null, 200, "OK", CACHE_HEADERS, stream)
        }
        // Formats such as HEIC are not displayed by WebView, so convert them.
        return bytes("image/jpeg", jpeg(decodeSampled(uri, FULL_MAX_SIZE)))
    }

    private fun original(id: Long): WebResourceResponse {
        var uri = imageUri(id)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) uri = MediaStore.setRequireOriginal(uri)
        val stream = context.contentResolver.openInputStream(uri) ?: return status(404)
        return WebResourceResponse(context.contentResolver.getType(uri) ?: "application/octet-stream", null, 200, "OK", mapOf("Cache-Control" to "no-store"), stream)
    }

    private fun decodeSampled(uri: Uri, maxSize: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxSize || bounds.outHeight / (sample * 2) >= maxSize) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: throw IOException("Cannot decode image")
        val rotation = context.contentResolver.openInputStream(uri)?.use { ExifInterface(it).rotationDegrees } ?: 0
        val matrix = Matrix()
        if (rotation != 0) matrix.postRotate(rotation.toFloat())
        // Sampling only halves sizes, so scale the rest of the way to the requested size.
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest > maxSize) matrix.postScale(maxSize.toFloat() / longest, maxSize.toFloat() / longest)
        if (matrix.isIdentity) return bitmap
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun jpeg(bitmap: Bitmap): ByteArray =
        ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()

    private fun imageUri(id: Long): Uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)

    private fun bytes(mimeType: String, data: ByteArray, headers: Map<String, String> = CACHE_HEADERS) =
        WebResourceResponse(mimeType, null, 200, "OK", headers, ByteArrayInputStream(data))

    private fun status(code: Int) =
        WebResourceResponse("text/plain", "utf-8", code, "Error", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private companion object {
        const val DEFAULT_THUMBNAIL_SIZE = 256
        const val SYSTEM_THUMBNAIL_MAX_SIZE = 640
        const val FULL_MAX_SIZE = 4096
        val WEB_IMAGE_TYPES = setOf("image/jpeg", "image/png", "image/webp", "image/gif")
        val CACHE_HEADERS = mapOf("Cache-Control" to "private, max-age=3600")
    }
}
