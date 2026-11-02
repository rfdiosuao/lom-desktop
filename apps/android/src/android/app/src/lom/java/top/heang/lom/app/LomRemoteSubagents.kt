package top.heang.lom.app

import com.openminis.app.MinisApp
import com.openminis.app.data.model.SubAgentDefinition
import com.openminis.app.data.model.SubAgentLimits
import com.openminis.app.data.model.SubAgentRoster
import com.openminis.app.agent.jobs.AgentSettings
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import top.heang.lom.remote.PhoneSubAgent
import top.heang.lom.remote.SubAgentWrite
import java.security.MessageDigest

internal fun subagentRevision(row: SubAgentDefinition): String = MessageDigest.getInstance("SHA-256")
    .digest(Json.encodeToString(row.copy(updatedAt = 0)).toByteArray())
    .joinToString("") { "%02x".format(it) }

/** Pure edit validation, executed under the native repository lock. */
internal fun editRemoteRoster(rows: List<SubAgentDefinition>, method: String, req: SubAgentWrite,
    groups: Set<String>): List<SubAgentDefinition> {
    require(req.id.matches(Regex("[A-Za-z0-9._-]{1,100}"))) { "subagent.invalid_id" }
    val prior = rows.find { it.id == req.id }
    if (prior == null) {
        check(method == "subagent.save" && req.revision.isEmpty()) { "subagent.missing" }
        check(rows.size < SubAgentLimits.MAX_COUNT) { "subagent.limit" }
    } else check(req.revision == subagentRevision(prior)) { "sync.conflict" }
    if (method == "subagent.delete") {
        check(prior?.isBuiltIn == false) { "subagent.builtin" }
        return rows.filterNot { it.id == req.id }
    }
    require(req.enabled in listOf("true", "false")) { "subagent.invalid_enabled" }
    val next = if (method == "subagent.toggle") {
        checkNotNull(prior) { "subagent.missing" }.copy(enabled = req.enabled == "true")
    } else {
        require(req.name.isNotBlank() && req.name.length <= SubAgentLimits.NAME_MAX_LENGTH &&
            req.description.isNotBlank() && req.description.length <= SubAgentLimits.DESCRIPTION_MAX_LENGTH &&
            req.instructions.length <= SubAgentLimits.INSTRUCTIONS_MAX_LENGTH) { "subagent.invalid_definition" }
        require(req.model_group.isEmpty() || req.model_group in groups) { "subagent.model_missing" }
        check(prior?.isBuiltIn != true || (req.name == prior.name && req.description == prior.description)) { "subagent.builtin" }
        check(rows.none { it.id != req.id && SubAgentRoster.nameKey(it.name) == SubAgentRoster.nameKey(req.name) }) { "subagent.duplicate_name" }
        (prior ?: SubAgentDefinition(id = req.id, name = req.name.trim(), description = req.description.trim(), sortOrder = rows.size))
            .copy(name = req.name.trim(), description = req.description.trim(), instructions = req.instructions,
                modelGroupId = req.model_group.ifEmpty { null }, enabled = req.enabled == "true")
    }.copy(updatedAt = System.currentTimeMillis())
    return if (prior == null) rows + next else rows.map { if (it.id == req.id) next else it }
}

internal class LomRemoteSubagents(private val app: MinisApp) {
    suspend fun handle(method: String, p: JSONObject): JSONObject {
        val repo = app.providerRepository
        repo.awaitConfigLoaded()
        if (method != "subagent.list") {
            val req = SubAgentWrite(p.getString("id"), p.optString("name"), p.optString("description"),
                p.optString("instructions"), p.optString("model_group"), p.optString("enabled"), p.getString("revision"))
            repo.editRemoteSubAgents {
                editRemoteRoster(it, method, req, repo.config.value.modelGroups.map { g -> g.id }.toSet())
            }
        }
        val groups = repo.config.value.modelGroups.toList()
        val items = repo.subAgents.map { row ->
            val wire = PhoneSubAgent(row.id, row.name, row.description, row.instructions,
                row.modelGroupId.orEmpty(), row.enabled.toString(), row.isBuiltIn.toString(), subagentRevision(row))
            JSONObject().put("id", wire.id).put("name", wire.name).put("description", wire.description)
                .put("instructions", wire.instructions).put("model_group", wire.model_group)
                .put("enabled", wire.enabled).put("builtin", wire.builtin).put("revision", wire.revision)
        }
        return JSONObject().put("items", JSONArray(items).toString())
            .put("groups", JSONArray(groups.map { JSONObject().put("id", it.id).put("name", it.name) }).toString())
            .put("delegation_enabled", AgentSettings.isEnabled(app).toString())
    }
}
