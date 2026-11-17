package io.github.csanadtelbisz.triplo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** Photo access plus the permission that keeps GPS data in EXIF. */
class GalleryPermission(private val activity: ComponentActivity) {
    private var pending: NativeBridge.Responder? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pending?.let(::respond)
        pending = null
    }

    fun request(responder: NativeBridge.Responder) {
        val missing = missingPermissions()
        if (missing.isEmpty()) return respond(responder)
        if (pending != null) return responder.reject("A permission request is already in progress")
        pending = responder
        launcher.launch(missing.toTypedArray())
    }

    private fun respond(responder: NativeBridge.Responder) =
        responder.resolve(JSONObject().put("granted", missingPermissions().isEmpty()))

    private fun missingPermissions(): List<String> {
        val required = mutableListOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.READ_MEDIA_IMAGES
            else Manifest.permission.READ_EXTERNAL_STORAGE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) required += Manifest.permission.ACCESS_MEDIA_LOCATION
        return required.filter { ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED }
    }
}
