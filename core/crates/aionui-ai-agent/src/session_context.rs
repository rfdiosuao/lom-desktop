use aionui_api_types::{AcpBuildExtra, AionrsBuildExtra, TeamSessionBinding};
use aionui_common::{AgentType, ProviderWithModel};

use crate::shared_kernel::PersistedSessionState;

/// Typed runtime-build input for creating or resuming an agent task.
///
/// This is the boundary after `conversation.extra` has been decoded by the
/// conversation domain. Agent factories should consume this typed shape rather
/// than re-parsing raw JSON from the DB envelope.
#[derive(Debug, Clone)]
pub struct AgentSessionContext {
    pub conversation: ConversationContext,
    pub workspace: WorkspaceContext,
    pub model: ProviderWithModel,
    pub skills: Vec<String>,
    pub runtime_env: Vec<(String, String)>,
    pub team: Option<TeamSessionBinding>,
    pub kind: AgentSessionKind,
}

#[derive(Debug, Clone)]
pub struct ConversationContext {
    pub conversation_id: String,
    pub user_id: String,
    pub agent_type: AgentType,
    pub source: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceContext {
    /// Workspace path used by the runtime.
    pub path: String,
    /// Workspace path already persisted in `conversation.extra.workspace`.
    /// Empty when this is a legacy row without a stored workspace.
    pub stored_path: String,
    /// Whether the user supplied this workspace explicitly.
    pub is_custom: bool,
}

#[derive(Debug, Clone)]
pub enum AgentSessionKind {
    Acp(Box<AcpSessionBuildContext>),
    Aionrs(Box<AionrsSessionBuildContext>),
    Antigravity(Box<AntigravitySessionBuildContext>),
}

#[derive(Debug, Clone)]
pub struct AcpSessionBuildContext {
    /// Operation-scoped explicit mode request. Never serialized or persisted as
    /// observed; the factory must verify it and the existing resume anchor before
    /// publishing the runtime or attaching its persistence consumer.
    pub required_mode_on_resume: Option<String>,
    pub config: AcpBuildExtra,
    pub team: Option<TeamSessionBinding>,
    pub belongs_to_team: bool,
    pub session_id: Option<String>,
    pub session_snapshot: Option<PersistedSessionState>,
}

/// Build inputs for an Antigravity (`agy` CLI) session.
///
/// Structurally the same as [`AcpSessionBuildContext`] — both describe a CLI
/// agent with a workspace, MCP servers, skills and a resume anchor — but kept
/// separate so the two never share a factory path (agy does not speak ACP).
#[derive(Debug, Clone)]
pub struct AntigravitySessionBuildContext {
    pub config: AcpBuildExtra,
    pub team: Option<TeamSessionBinding>,
    pub belongs_to_team: bool,
    /// The agy conversation id to resume, when this session has run before.
    pub session_id: Option<String>,
    pub session_snapshot: Option<PersistedSessionState>,
}

#[derive(Debug, Clone)]
pub struct AionrsSessionBuildContext {
    pub config: AionrsBuildExtra,
    pub team: Option<TeamSessionBinding>,
    pub belongs_to_team: bool,
}

impl AgentSessionContext {
    pub fn conversation_id(&self) -> &str {
        &self.conversation.conversation_id
    }

    pub fn agent_type(&self) -> AgentType {
        self.conversation.agent_type
    }
}

impl AcpSessionBuildContext {
    pub fn require_mode_on_resume(&mut self, mode: &str) -> Result<(), crate::AgentError> {
        if self.session_id.as_deref().is_none_or(str::is_empty) {
            return Err(crate::AgentError::bad_request(
                "Permission change requires an existing backend session",
            ));
        }
        self.required_mode_on_resume = Some(mode.to_owned());
        self.config.session_mode = Some(mode.to_owned());
        let snapshot = self.session_snapshot.get_or_insert_with(Default::default);
        snapshot.current_mode_id = Some(crate::shared_kernel::ModeId::new(mode));
        snapshot.config_selections.insert(
            crate::shared_kernel::ConfigKey::new("mode"),
            crate::shared_kernel::ConfigValue::new(mode),
        );
        Ok(())
    }
}

#[cfg(test)]
mod explicit_permission_resume_tests {
    use super::*;
    #[test]
    fn explicit_permission_intent_is_only_an_owned_build_override() {
        let original = AcpSessionBuildContext {
            required_mode_on_resume: None,
            config: AcpBuildExtra {
                session_mode: Some("default".into()),
                ..Default::default()
            },
            team: None,
            belongs_to_team: true,
            session_id: Some("same-backend-session".into()),
            session_snapshot: Some(PersistedSessionState {
                current_mode_id: Some(crate::shared_kernel::ModeId::new("default")),
                ..Default::default()
            }),
        };
        let mut replacement = original.clone();
        replacement.require_mode_on_resume("yolo").unwrap();
        assert_eq!(replacement.session_id, original.session_id);
        assert_eq!(replacement.required_mode_on_resume.as_deref(), Some("yolo"));
        assert_eq!(
            original.session_snapshot.unwrap().current_mode_id.unwrap().as_str(),
            "default"
        );
        assert_eq!(original.config.session_mode.as_deref(), Some("default"));
        replacement.session_id = None;
        assert!(
            replacement
                .require_mode_on_resume("yolo")
                .unwrap_err()
                .to_string()
                .contains("existing backend session")
        );
    }
}
