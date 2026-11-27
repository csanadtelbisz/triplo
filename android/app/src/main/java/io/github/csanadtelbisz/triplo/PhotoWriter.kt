package io.github.csanadtelbisz.triplo

import android.content.ContentUris
import android.app.RecoverableSecurityException
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebMessageCompat
import org.json.JSONArray
import org.json.JSONObject

class PhotoWriter(private val activity: ComponentActivity, private val gallery: GalleryHandler) {
    private var pending: NativeBridge.Responder? = null
    private data class PendingSave(val id: Long, val bytes: ByteArray, val reply: androidx.webkit.JavaScriptReplyProxy)
    private var pendingSave: PendingSave? = null
    private val storagePermissionLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val responder = pending ?: return@registerForActivityResult
        pending = null
        if (granted) responder.resolve(JSONObject().put("granted", true))
        else responder.reject("Photo write permission was not granted")
    }
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result: ActivityResult ->
        pendingSave?.let { save ->
            pendingSave = null
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                try { write(save.id, save.bytes); save.reply.postMessage(JSONObject().put("ok", true).put("id", save.id).toString()) }
                catch (error: Exception) { replyError(save.reply, error) }
            } else replyError(save.reply, IllegalStateException("Photo write permission was not granted"))
            return@registerForActivityResult
        }
        val responder = pending ?: return@registerForActivityResult
        pending = null
        if (result.resultCode == android.app.Activity.RESULT_OK) responder.resolve(JSONObject().put("granted", true))
        else responder.reject("Photo write permission was not granted")
    }

    fun requestWrite(args: JSONObject, responder: NativeBridge.Responder) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
                return responder.resolve(JSONObject().put("granted", true))
            }
            if (pending != null) return responder.reject("A photo permission request is already active")
            pending = responder
            storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) return responder.resolve(JSONObject().put("granted", true))
        if (pending != null) return responder.reject("A photo permission request is already active")
        val ids = args.optJSONArray("ids") ?: JSONArray()
        if (ids.length() == 0) return responder.resolve(JSONObject().put("granted", true))
        val uris = (0 until ids.length()).map { ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ids.getLong(it)) }
        pending = responder
        try {
            val request = MediaStore.createWriteRequest(activity.contentResolver, uris)
            launcher.launch(IntentSenderRequest.Builder(request.intentSender).build())
        } catch (error: Exception) {
            pending = null
            responder.reject(error.message ?: "Could not request photo write access")
        }
    }

    fun saveMessage(message: WebMessageCompat, reply: androidx.webkit.JavaScriptReplyProxy) {
        try {
            require(message.type == WebMessageCompat.TYPE_ARRAY_BUFFER)
            val packet = message.arrayBuffer
            val headerSize = java.nio.ByteBuffer.wrap(packet, 0, 4).int
            require(headerSize in 1..1024 && packet.size > 4 + headerSize)
            val header = JSONObject(String(packet, 4, headerSize, Charsets.UTF_8))
            val id = header.getLong("id")
            val data = packet.copyOfRange(4 + headerSize, packet.size)
            try { write(id, data) }
            catch (error: RecoverableSecurityException) {
                pendingSave = PendingSave(id, data, reply)
                launcher.launch(IntentSenderRequest.Builder(error.userAction.actionIntent.intentSender).build())
                return
            }
            reply.postMessage(JSONObject().put("ok", true).put("id", id).toString())
        } catch (error: Exception) {
            replyError(reply, error)
        }
    }

    private fun write(id: Long, data: ByteArray) {
        val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
        activity.contentResolver.openOutputStream(uri, "wt")?.use { it.write(data) }
            ?: throw IllegalStateException("Photo provider did not open the original for writing")
        gallery.invalidateMetadata(id)
    }

    private fun replyError(reply: androidx.webkit.JavaScriptReplyProxy, error: Exception) {
        reply.postMessage(JSONObject().put("ok", false).put("error", error.message ?: "Could not save photo").toString())
    }
}
