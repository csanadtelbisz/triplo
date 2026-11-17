package io.github.csanadtelbisz.triplo

import android.app.Activity
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject

/** Saves text exports (GPX), which cannot use WebView downloads because they are blob URLs. */
class FileSaver(private val activity: ComponentActivity) {
    private var pending: Pair<NativeBridge.Responder, String>? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val (responder, content) = pending ?: return@registerForActivityResult
        pending = null
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            return@registerForActivityResult responder.resolve(JSONObject().put("saved", false))
        }
        try {
            activity.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(content.toByteArray()) }
            responder.resolve(JSONObject().put("saved", true))
        } catch (e: Exception) {
            responder.reject(e.message ?: "Could not write file")
        }
    }

    fun save(args: JSONObject, responder: NativeBridge.Responder) {
        if (pending != null) return responder.reject("Another save is in progress")
        pending = responder to args.getString("content")
        launcher.launch(
            Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(args.optString("mimeType", "application/octet-stream"))
                .putExtra(Intent.EXTRA_TITLE, args.getString("filename"))
        )
    }
}
