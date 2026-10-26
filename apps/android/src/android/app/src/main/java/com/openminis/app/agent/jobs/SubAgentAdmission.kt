package com.openminis.app.agent.jobs

import com.openminis.app.data.model.SubAgentDefinition
import com.openminis.app.data.model.SubAgentRoster

/** Shared admission for new work, interrupted runs and queued work. */
internal object SubAgentAdmission {
    fun resolve(enabled: Boolean, name: String?, roster: List<SubAgentDefinition>): SubAgentDefinition? =
        if (enabled) SubAgentRoster.resolve(name, roster) else null
}
