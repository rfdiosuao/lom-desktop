package top.heang.lom.pairing.cloud

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import top.heang.lom.remote.Envelope

/** The host implements native Agent operations; the transport never executes shell commands. */
fun interface LomRemoteHandler { suspend fun handle(method: String, payload: JSONObject, desktop: String): JSONObject }
object LomRemote {
    private const val REPLAY_WINDOW = 600000L
    private val replayGate = Mutex()
    @Volatile var handler: LomRemoteHandler? = null
    /** Long-term identity: unlocked from Keystore once per process, not on every request. It never changes while paired. */
    @Volatile private var identity: LomIdentity? = null
    /** sender:id → first seen. Mirrors `lom_remote_seen`, so a restart still rejects replays inside the window;
     *  lookups and pruning stay in memory and the disk write is asynchronous instead of an fsync per request. */
    private var seen: HashMap<String, Long>? = null

    private fun identity(context: Context): LomIdentity = identity ?: synchronized(this) {
        identity ?: LomIdentity.loadOrCreate(context).also { identity = it }
    }

    private suspend fun remember(context: Context, key: String) = replayGate.withLock {
        val prefs = context.getSharedPreferences("lom_remote_seen", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val map = seen ?: HashMap<String, Long>().also { m ->
            prefs.all.forEach { (k, v) -> (v as? Long)?.let { m[k] = it } }
            seen = m
        }
        check(key !in map) { "remote.replayed" }
        val edit = prefs.edit()
        map.entries.removeAll { (k, at) -> (at < now - REPLAY_WINDOW).also { old -> if (old) edit.remove(k) } }
        map[key] = now
        edit.putLong(key, now).apply()
    }

    internal suspend fun receive(context: Context, store: KeystorePairingStore, json: JSONObject): JSONObject? = withContext(Dispatchers.IO) {
        val paired = store.load() ?: return@withContext null
        val e = json.getJSONObject("envelope").let { Envelope(it.getString("id"), it.getString("sender"),
            it.getString("recipient"), it.getString("ephemeral"), it.getString("ciphertext"), it.getString("signature")) }
        val identity = identity(context)
        val req = try { JSONObject(identity.crypto.open(e, paired.desktops.map { it.keys }.toSet())) }
            catch (ex: Exception) { android.util.Log.w("LomRemote", "Rejected unauthenticated envelope"); return@withContext null }
        val response = try {
            require(kotlin.math.abs(System.currentTimeMillis() - req.getString("issued_at").toLong()) <= 300000) { "remote.expired" }
            check(store.load() == paired) { "remote.revoked" }
            remember(context, e.sender + ":" + e.id)
            val h = handler ?: error("remote.not_ready")
            JSONObject().put("status", "ok").put("payload", h.handle(req.getString("method"), JSONObject(req.getString("payload")), e.sender).toString()).put("error", "")
        } catch (ex: CancellationException) { throw ex
        } catch (ex: Exception) {
            val code = ex.message?.takeIf { it.matches(Regex("[a-z_]+\\.[a-z_]+")) } ?: "remote.operation_failed"
            JSONObject().put("status", "error").put("payload", "{}").put("error", code)
        }
        val reply = identity.crypto.seal(e.sender, e.id, response.toString())
        JSONObject().put("type", "task.reply").put("envelope", JSONObject()
            .put("id",reply.id).put("sender",reply.sender).put("recipient",reply.recipient)
            .put("ephemeral",reply.ephemeral).put("ciphertext",reply.ciphertext).put("signature",reply.signature))
    }
}
