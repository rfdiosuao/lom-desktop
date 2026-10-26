package top.heang.lom.pairing.cloud

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import top.heang.lom.pairing.CodeClaim
import top.heang.lom.pairing.Credential
import top.heang.lom.pairing.DesktopView
import top.heang.lom.pairing.DeviceInfo
import top.heang.lom.pairing.PairedState
import top.heang.lom.pairing.PairingApi
import top.heang.lom.pairing.PairingFailure

/** R01 §2.8 cloud endpoints over HTTPS. Tokens go in bodies or headers, never in URLs or logs. */
internal class HttpPairingApi(private val client: OkHttpClient) : PairingApi {
    companion object {
        fun client(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS)
            .build()
        private val JSON_TYPE = "application/json".toMediaType()
    }

    private suspend fun call(host: String, method: String, path: String, body: JSONObject?,
        authorization: String? = null): JSONObject = withContext(Dispatchers.IO) {
        if (!LomPairing.CLOUD_ENABLED) throw PairingFailure("pairing.unavailable")
        val request = Request.Builder().url("https://$host$path")
            .method(method, body?.toString()?.toRequestBody(JSON_TYPE))
            .apply { authorization?.let { header("Authorization", it) } }
            .build()
        val text = try {
            client.newCall(request).execute().use { it.body?.string().orEmpty() }
        } catch (e: IOException) {
            throw PairingFailure("net.unreachable")
        }
        val json = try { JSONObject(text) } catch (e: JSONException) { throw PairingFailure("pairing.response_invalid") }
        if (!json.optBoolean("success")) throw PairingFailure(json.optString("code").ifEmpty { "pairing.operation_failed" })
        json.optJSONObject("data") ?: JSONObject()
    }

    private fun info(i: DeviceInfo) = JSONObject().put("name", i.name).put("model", i.model)
        .put("os", i.os).put("app_version", i.appVersion)

    private fun desktop(d: JSONObject) = try {
        DesktopView(d.getString("pairing_id"), d.getString("desktop_name"), d.getString("desktop_keys"),
            d.optString("masked_account"), d.getLong("expires_at"))
    } catch (e: JSONException) { throw PairingFailure("pairing.response_invalid") }

    override suspend fun inspect(host: String, pairingId: String, claimToken: String) =
        desktop(call(host, "POST", "/v1/pairing/sessions/$pairingId/inspect", JSONObject().put("claim_token", claimToken)))

    override suspend fun claim(host: String, pairingId: String, claimToken: String, deviceKeys: String,
        info: DeviceInfo, keyProof: String): String {
        val body = JSONObject().put("claim_token", claimToken).put("device_keys", deviceKeys)
            .put("device_info", info(info)).put("key_proof", keyProof)
        return call(host, "POST", "/v1/pairing/sessions/$pairingId/claim", body).optString("claim_secret")
            .ifEmpty { throw PairingFailure("pairing.response_invalid") }
    }

    override suspend fun claimByCode(host: String, code: String, deviceKeys: String, info: DeviceInfo): CodeClaim {
        val body = JSONObject().put("manual_code", code).put("device_keys", deviceKeys).put("device_info", info(info))
        val data = call(host, "POST", "/v1/pairing/claim-by-code", body)
        val secret = data.optString("claim_secret").ifEmpty { throw PairingFailure("pairing.response_invalid") }
        return CodeClaim(desktop(data), secret)
    }

    override suspend fun confirm(host: String, pairingId: String, claimSecret: String): Credential {
        val d = call(host, "POST", "/v1/pairing/sessions/$pairingId/confirm", JSONObject().put("claim_secret", claimSecret))
        return try {
            Credential(d.getString("device_id"), d.getString("device_token"), d.getLong("token_expires_at"),
                d.getString("desktop_name"))
        } catch (e: JSONException) { throw PairingFailure("pairing.response_invalid") }
    }

    override suspend fun cancel(host: String, pairingId: String, claimSecret: String) {
        call(host, "POST", "/v1/pairing/sessions/$pairingId/cancel", JSONObject().put("claim_secret", claimSecret))
    }

    /** Device credential → 1-hour relay token (also extends the 90-day credential). */
    suspend fun relayToken(state: PairedState): String =
        call(state.host, "POST", "/v1/relay/token", JSONObject(), state.authorization).optString("relay_token")
            .ifEmpty { throw PairingFailure("pairing.response_invalid") }

    suspend fun unpairSelf(state: PairedState) {
        call(state.host, "DELETE", "/v1/devices/me", null, state.authorization)
    }
}
