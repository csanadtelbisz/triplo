package io.github.csanadtelbisz.triplo

import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject

/** Request/response messaging for window.TriploNative; see frontend/src/native/native.ts. */
class NativeBridge(private val handlers: Map<String, Handler>) {

    fun interface Handler {
        fun handle(args: JSONObject, responder: Responder)
    }

    class Responder(private val id: String, private val reply: JavaScriptReplyProxy) {
        fun resolve(result: JSONObject = JSONObject()) = send(true, result, null)
        fun reject(message: String) = send(false, null, message)

        private fun send(ok: Boolean, result: JSONObject?, error: String?) {
            val response = JSONObject().put("id", id).put("ok", ok)
            if (result != null) response.put("result", result)
            if (error != null) response.put("error", error)
            reply.postMessage(response.toString())
        }
    }

    fun onMessage(text: String, reply: JavaScriptReplyProxy) {
        val message = JSONObject(text)
        val responder = Responder(message.getString("id"), reply)
        val handler = handlers[message.getString("method")]
            ?: return responder.reject("Unknown native method: ${message.getString("method")}")
        try {
            handler.handle(message.optJSONObject("args") ?: JSONObject(), responder)
        } catch (e: Exception) {
            responder.reject(e.message ?: e.toString())
        }
    }
}
