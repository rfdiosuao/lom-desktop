package com.openminis.app.agent.jobs

import com.openminis.app.data.model.SubAgentDefinition
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/** Exercises the real queue with the same live admission gate as the view model. */
class SubAgentAdmissionQueueTest {
    private val parent = "phone01-admission"
    private val editor = SubAgentDefinition(id = "editor", name = "Editor", description = "Edit")
    private val researcher = SubAgentDefinition(id = "researcher", name = "Researcher", description = "Research")
    private var enabled = true
    private var roster = listOf(editor, researcher)
    private val started = mutableListOf<String>()
    private val rejected = mutableListOf<String>()

    @Before fun setup() {
        AgentJobRegistry.resetForTest()
        AgentJobRegistry.dropQueuedDelegations(parent, "setup")
        AgentJobRegistry.registerQueuedStarter(parent) { item ->
            val definition = SubAgentAdmission.resolve(enabled, item.argsJson, roster)
            if (definition == null) {
                rejected += item.toolUseId
                false
            } else {
                started += definition.id
                child(item.toolUseId)
                true
            }
        }
    }

    @After fun cleanup() {
        AgentJobRegistry.unregisterQueuedStarter(parent)
        AgentJobRegistry.dropQueuedDelegations(parent, "cleanup")
        AgentJobRegistry.resetForTest()
    }

    private fun child(tool: String) = AgentJobRegistry.register(
        title = tool, origin = AgentJobOrigin.TOOL, trigger = AgentJobTrigger.Immediate,
        target = AgentJobTarget.ChildOfCurrent(parent, tool), prompt = "work", then = AgentJobThen.None,
    )
    private fun enqueue(name: String, tool: String) {
        assertTrue(AgentJobRegistry.enqueueDelegation(AgentJobRegistry.QueuedDelegation(parent, name, tool)))
    }

    @Test fun disabledQueueHeadDoesNotStrandNextEnabledAgent() {
        val occupying = List(AgentJobRegistry.MAX_CONCURRENT_CHILD_JOBS) { child("busy-$it") }
        enqueue(editor.name, "a")
        enqueue(researcher.name, "b")
        // The remote switch changes after enqueue but before a slot becomes free.
        roster = listOf(editor.copy(enabled = false), researcher)
        AgentJobRegistry.finish(occupying.first().id, AgentJobState.DONE, "done")
        assertEquals(listOf("a"), rejected)
        assertEquals(listOf("researcher"), started)
        assertEquals(0, AgentJobRegistry.queuedCount(parent))
        assertEquals(3, AgentJobRegistry.runningChildJobCount)
    }

    @Test fun globalOffDrainsWithoutStartingEvenWhenDefinitionsAreEnabled() {
        val occupying = List(AgentJobRegistry.MAX_CONCURRENT_CHILD_JOBS) { child("busy-$it") }
        enqueue(editor.name, "a")
        enqueue(researcher.name, "b")
        enabled = false
        AgentJobRegistry.finish(occupying.first().id, AgentJobState.DONE, "done")
        assertEquals(listOf("a", "b"), rejected)
        assertTrue(started.isEmpty())
        assertEquals(0, AgentJobRegistry.queuedCount(parent))
    }

    @Test fun resumeAdmissionHonorsGlobalAndIndividualSwitchesWithoutFallback() {
        val builtin = SubAgentDefinition.makeBuiltIn()
        assertNull(SubAgentAdmission.resolve(false, editor.name, listOf(editor)))
        assertNull(SubAgentAdmission.resolve(false, null, listOf(builtin)))
        assertNull(SubAgentAdmission.resolve(true, editor.name, listOf(editor.copy(enabled = false), builtin)))
        assertNull(SubAgentAdmission.resolve(true, null, listOf(builtin.copy(enabled = false), editor)))
        assertEquals(editor.id, SubAgentAdmission.resolve(true, editor.name, listOf(editor))?.id)
    }
}
