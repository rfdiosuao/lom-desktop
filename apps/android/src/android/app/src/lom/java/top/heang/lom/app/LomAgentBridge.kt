package top.heang.lom.app

import android.content.Context
import com.openminis.app.MinisApp
import com.openminis.app.data.model.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import top.heang.lom.pairing.cloud.LomRemote
import top.heang.lom.pairing.cloud.LomRemoteHandler
import java.net.URI
import java.security.MessageDigest

internal fun digest(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

internal class LomAgentBridge(private val app: MinisApp) : LomRemoteHandler {
    private val models = Mutex()
    private val files = LomRemoteFiles(app)
    private val skills = LomRemoteSkills(app, files)
    private val chats = LomRemoteChats(app, files)
    private val schedules = LomRemoteSchedules(app)
    private val docs = LomRemoteDocuments(app)
    private val subagents = LomRemoteSubagents(app)
    private val prefs = app.getSharedPreferences("lom_remote_sync", Context.MODE_PRIVATE)
    private val screen = LomRemoteScreen(app)
    override suspend fun handle(method: String, payload: JSONObject, desktop: String): JSONObject {
        check(app.subsystemsReady()) { "remote.not_ready" }
        return when (method) {
            "subagent.list", "subagent.save", "subagent.toggle", "subagent.delete" -> subagents.handle(method, payload)
            "skills.list", "skills.read", "skills.install", "skills.delete", "skills.toggle" -> skills.handle(method, payload, desktop)
            "screen.capture", "screen.tree", "screen.control" -> screen.handle(method, payload, desktop)
            "device.status" -> deviceStatus(app)
            "device.rename" -> JSONObject().put("name", top.heang.lom.pairing.cloud.LomDeviceName.save(app, payload.getString("name")))
            "apps.list" -> phoneApps(app)
            "model.sync" -> models.withLock { model(payload, desktop) }
            "chat.send" -> chats.send(payload, desktop)
            "chat.read" -> chats.read(payload)
            "chat.file" -> files.prepare(payload, desktop)
            "chat.image" -> files.prepareImage(payload, desktop)
            "chat.list" -> chats.list(payload)
            "chat.cancel" -> chats.cancel(payload)
            "chat.rename", "chat.delete", "chat.pin" -> chats.change(method,payload)
            "document.list" -> docs.list()
            "document.read" -> docs.read(payload)
            "document.write" -> docs.write(payload)
            "file.begin", "file.chunk", "file.finish", "file.status", "file.read", "file.list", "file.delete", "file.save_gallery" -> files.handle(method, payload, desktop)
            "schedule.list", "schedule.save", "schedule.toggle", "schedule.delete", "schedule.run" -> schedules.handle(method, payload, desktop)
            else -> error("remote.method_unknown")
        }
    }
    private suspend fun model(p: JSONObject, desktop: String): JSONObject {
        val url = p.getString("base_url").trim().trimEnd('/')
        val uri = URI(url)
        require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.fragment == null && uri.query == null) { "model.invalid_url" }
        val key = p.getString("api_key"); val model = p.getString("model").trim()
        require(key.isNotBlank() && key.length <= 16384 && model.isNotBlank() && model.length <= 256) { "model.invalid_config" }
        val type = when(p.getString("platform")) {
            "openai" -> ProviderType.openAI
            "openai-responses" -> ProviderType.openAIResponses
            "anthropic" -> ProviderType.anthropic
            "gemini" -> ProviderType.gemini
            else -> error("model.unsupported_protocol")
        }
        val id = "lom-" + digest(desktop).take(24)
        val revision = p.getString("revision").toLong()
        require(revision >= prefs.getLong(id, 0)) { "model.stale_revision" }
        val repo = app.providerRepository
        repo.awaitConfigLoaded()
        val instance = ProviderInstance(id, "Lom · 电脑同步", type, ProviderCredential.apiKey,
            customBaseURL = url, appendV1Suffix = false, useResponsesAPI = type == ProviderType.openAIResponses)
        val entry = ModelEntry(id, LLMModel(model, model, type.name), isCustom = true, uuid = "$id/$model")
        repo.importLomModel(instance, entry, ModelGroup(id = id, name = "Lom · 默认模型", memberEntryIds = mutableListOf(entry.id)), key)
        check(prefs.edit().putLong(id, revision).commit()) { "model.revision_save_failed" }
        return JSONObject().put("model", model).put("revision", revision.toString()).put("status", "saved")
    }
}

/** Registered by the Lom flavor only. No startup-time dependency on initialized repositories. */
class LomAgentInitProvider : android.content.ContentProvider() {
    override fun onCreate(): Boolean {
        (context?.applicationContext as? MinisApp)?.let { LomRemote.handler = LomAgentBridge(it) }
        return true
    }
    override fun query(u: android.net.Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?) = null
    override fun getType(uri: android.net.Uri): String? = null
    override fun insert(uri: android.net.Uri, values: android.content.ContentValues?) = null
    override fun delete(uri: android.net.Uri, s: String?, a: Array<String>?) = 0
    override fun update(u: android.net.Uri, v: android.content.ContentValues?, s: String?, a: Array<String>?) = 0
}
