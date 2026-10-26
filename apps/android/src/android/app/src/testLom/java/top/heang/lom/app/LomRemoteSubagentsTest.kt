package top.heang.lom.app

import com.openminis.app.data.model.SubAgentDefinition
import com.openminis.app.data.model.SubAgentRoster
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import top.heang.lom.remote.SubAgentWrite

class LomRemoteSubagentsTest {
    private val row = SubAgentDefinition(id="editor",name="Editor",description="Edit drafts",instructions="Keep facts",modelGroupId="group")
    private fun request(r: SubAgentDefinition = row) = SubAgentWrite(r.id,r.name,r.description,r.instructions,r.modelGroupId.orEmpty(),r.enabled.toString(),subagentRevision(r))
    @Test fun phone01TogglePersistsAndRejectsDelegation() {
        val rows=listOf(SubAgentDefinition.makeBuiltIn(),row)
        val changed=editRemoteRoster(rows,"subagent.toggle",request().copy(enabled="false"),setOf("group"))
        val disabled=changed.last()
        assertFalse(disabled.enabled)
        assertEquals(row.instructions,disabled.instructions)
        assertEquals(row.modelGroupId,disabled.modelGroupId)
        assertNull(SubAgentRoster.resolve("Editor",changed))
        assertFalse(Json.decodeFromString<SubAgentDefinition>(Json.encodeToString(disabled)).enabled)
        val enabled=editRemoteRoster(changed,"subagent.toggle",request(disabled).copy(enabled="true"),setOf("group"))
        assertNotNull(SubAgentRoster.resolve("Editor",enabled))
    }
    @Test fun phone01ConcurrentNativeEditConflicts() {
        val changed=row.copy(instructions="New native edit")
        assertEquals("sync.conflict",runCatching { editRemoteRoster(listOf(changed),"subagent.toggle",request().copy(enabled="false"),setOf("group")) }.exceptionOrNull()?.message)
    }
    @Test fun phone01SaveValidatesModelNameAndMissingRows() {
        val rows=listOf(SubAgentDefinition.makeBuiltIn(),row)
        assertEquals("subagent.model_missing",runCatching { editRemoteRoster(rows,"subagent.save",request().copy(model_group="missing"),emptySet()) }.exceptionOrNull()?.message)
        assertEquals("subagent.duplicate_name",runCatching { editRemoteRoster(rows,"subagent.save",request().copy(id="new",revision=""),setOf("group")) }.exceptionOrNull()?.message)
        assertEquals("subagent.missing",runCatching { editRemoteRoster(rows,"subagent.toggle",request().copy(id="missing"),setOf("group")) }.exceptionOrNull()?.message)
        assertEquals("subagent.invalid_enabled",runCatching { editRemoteRoster(rows,"subagent.toggle",request().copy(enabled="yes"),setOf("group")) }.exceptionOrNull()?.message)
    }
    @Test fun phone01BuiltinCannotBeDeletedOrRenamed() {
        val builtin=SubAgentDefinition.makeBuiltIn()
        assertEquals("subagent.builtin",runCatching { editRemoteRoster(listOf(builtin),"subagent.delete",request(builtin),emptySet()) }.exceptionOrNull()?.message)
        assertEquals("subagent.builtin",runCatching { editRemoteRoster(listOf(builtin),"subagent.save",request(builtin).copy(name="other"),emptySet()) }.exceptionOrNull()?.message)
        assertNull(SubAgentRoster.resolve(null,listOf(builtin.copy(enabled=false),row)))
    }
}
