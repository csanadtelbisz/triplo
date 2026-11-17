package io.github.csanadtelbisz.triplo

import androidx.activity.ComponentActivity
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import org.json.JSONObject

/**
 * Google Drive authorization through Play services. Google blocks its web
 * sign-in inside a WebView. The OAuth client is found by package name and signing certificate.
 */
class GoogleAuth(private val activity: ComponentActivity) {
    private var pending: NativeBridge.Responder? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val responder = pending ?: return@registerForActivityResult
        pending = null
        try {
            deliver(responder, Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data))
        } catch (e: Exception) {
            responder.reject(e.message ?: "Authorization was cancelled")
        }
    }

    fun authorize(responder: NativeBridge.Responder) {
        if (pending != null) return responder.reject("Authorization already in progress")
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(DRIVE_FILE_SCOPE)))
            .build()
        Identity.getAuthorizationClient(activity).authorize(request)
            .addOnSuccessListener { result ->
                val intent = result.pendingIntent
                if (result.hasResolution() && intent != null) {
                    pending = responder
                    launcher.launch(IntentSenderRequest.Builder(intent.intentSender).build())
                } else {
                    deliver(responder, result)
                }
            }
            .addOnFailureListener { responder.reject(it.message ?: "Authorization failed") }
    }

    private fun deliver(responder: NativeBridge.Responder, result: AuthorizationResult) {
        val token = result.accessToken ?: return responder.reject("No access token received")
        // The result carries no expiry. Tokens last about an hour, so renew early.
        responder.resolve(JSONObject().put("accessToken", token).put("expiresInSeconds", TOKEN_LIFETIME_SECONDS))
    }

    private companion object {
        const val DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
        const val TOKEN_LIFETIME_SECONDS = 1800
    }
}
