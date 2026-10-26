package top.heang.lom.pairing.cloud

import android.content.Context
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import top.heang.lom.pairing.AuthorizedDesktop
import top.heang.lom.pairing.PairedState
import top.heang.lom.pairing.PairingStore

/** Device credential and authorized desktops, encrypted under Keystore (R01 §2.5.4). */
internal class KeystorePairingStore(context: Context) : PairingStore {
    private val file = SecureFile(File(context.noBackupFilesDir, "lom-pairing.bin"))
    private val current = MutableStateFlow(readOrNull())
    val state: StateFlow<PairedState?> = current.asStateFlow()

    override fun load(): PairedState? = current.value

    override suspend fun save(state: PairedState) = withContext(Dispatchers.IO) {
        file.write(encode(state).toString().toByteArray())
        current.value = state
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        file.delete()
        current.value = null
    }

    private fun readOrNull(): PairedState? = try {
        file.read()?.let { decode(JSONObject(String(it))) }
    } catch (e: Exception) {
        // Unreadable (e.g. Keystore key lost after a restore): treat as unpaired; the server
        // will reject the old credential anyway and the user can pair again.
        android.util.Log.w("LomPairing", "stored pairing unreadable: ${e.javaClass.simpleName}")
        null
    }

    private fun encode(s: PairedState) = JSONObject()
        .put("host", s.host).put("device_id", s.deviceId).put("device_token", s.deviceToken)
        .put("token_expires_at", s.tokenExpiresAtSeconds)
        .put("desktops", JSONArray(s.desktops.map {
            JSONObject().put("name", it.name).put("keys", it.keys).put("paired_at", it.pairedAtMillis)
        }))

    private fun decode(j: JSONObject): PairedState {
        val list = j.getJSONArray("desktops")
        val desktops = (0 until list.length()).map { i ->
            val d = list.getJSONObject(i)
            AuthorizedDesktop(d.getString("name"), d.getString("keys"), d.getLong("paired_at"))
        }
        return PairedState(j.getString("host"), j.getString("device_id"), j.getString("device_token"),
            j.getLong("token_expires_at"), desktops)
    }
}
