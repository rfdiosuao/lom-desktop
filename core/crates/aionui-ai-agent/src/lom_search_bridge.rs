//! S06-C: per-conversation MCP bridge for external agents.
//!
//! The bridge process is an `aioncore` stdio MCP server that only holds the
//! conversation-scoped runtime token; cloud login and provider credentials stay
//! inside the core process. Native aionrs sessions keep the in-process
//! `LomWebSearch` / `LomWebFetch` tools and never get this bridge.

use std::path::Path;

use aionui_api_types::lom_search::{LOM_SEARCH_MCP_SERVER_NAME, LOM_SEARCH_MCP_SUBCOMMAND};

use crate::session_context::AgentSessionKind;

pub const ENV_BASE_URL: &str = "AIONUI_BASE_URL";
pub const ENV_USER_ID: &str = "AIONUI_USER_ID";
pub const ENV_CONVERSATION_ID: &str = "AIONUI_CONVERSATION_ID";
pub const ENV_RUNTIME_TOKEN: &str = "AIONUI_RUNTIME_TOKEN";

/// Backends without per-session MCP support cannot receive the bridge.
pub fn supports_backend(backend: &str) -> bool {
    backend != "antigravity"
}

/// Only ACP-family sessions spawn the bridge child. Native `aionrs` keeps its
/// in-process search tools (no duplicate registration), Antigravity exposes no
/// per-session MCP surface, and side chats are tool-less by product decision —
/// none of them may receive the `search:call` scope.
pub fn session_tools_allowed(kind: &AgentSessionKind) -> bool {
    matches!(kind, AgentSessionKind::Acp(_))
}

/// The neutral stdio spec for a direct-CLI session, or `None` when the backend
/// cannot host per-session MCP or the account has no verified binding.
pub fn search_stdio_spec(
    backend: &str,
    bound: bool,
    runtime_env: &[(String, String)],
    binary_path: &Path,
) -> Option<aionui_session::McpServerSpec> {
    if !bound || !supports_backend(backend) {
        return None;
    }
    Some(SearchBridgeEnv::from_runtime_env(runtime_env)?.stdio_spec(binary_path))
}

/// The ACP `session/new` server for an external ACP vendor. `backend: None` is
/// accepted (a catalog row without a vendor label still supports MCP).
pub fn search_acp_server(
    backend: Option<&str>,
    bound: bool,
    runtime_env: &[(String, String)],
    binary_path: &Path,
) -> Option<agent_client_protocol::schema::v1::McpServer> {
    if !bound || !backend.is_none_or(supports_backend) {
        return None;
    }
    Some(SearchBridgeEnv::from_runtime_env(runtime_env)?.acp_server(binary_path))
}

/// The four loopback values handed to the bridge process.
#[derive(Clone)]
pub struct SearchBridgeEnv {
    base_url: String,
    user_id: String,
    conversation_id: String,
    runtime_token: String,
}

impl std::fmt::Debug for SearchBridgeEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SearchBridgeEnv")
            .field("base_url", &self.base_url)
            .field("user_id", &self.user_id)
            .field("conversation_id", &self.conversation_id)
            .field("runtime_token", &"<redacted>")
            .finish()
    }
}

impl SearchBridgeEnv {
    pub fn from_runtime_env(runtime_env: &[(String, String)]) -> Option<Self> {
        let value = |name: &str| {
            runtime_env
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        };
        Some(Self {
            base_url: value(ENV_BASE_URL)?,
            user_id: value(ENV_USER_ID)?,
            conversation_id: value(ENV_CONVERSATION_ID)?,
            runtime_token: value(ENV_RUNTIME_TOKEN)?,
        })
    }

    fn env_pairs(&self) -> Vec<(String, String)> {
        vec![
            (ENV_BASE_URL.to_owned(), self.base_url.clone()),
            (ENV_USER_ID.to_owned(), self.user_id.clone()),
            (ENV_CONVERSATION_ID.to_owned(), self.conversation_id.clone()),
            (ENV_RUNTIME_TOKEN.to_owned(), self.runtime_token.clone()),
        ]
    }

    pub fn stdio_spec(&self, binary_path: &Path) -> aionui_session::McpServerSpec {
        aionui_session::McpServerSpec {
            name: LOM_SEARCH_MCP_SERVER_NAME.to_owned(),
            transport: aionui_session::McpTransport::Stdio {
                command: binary_path.to_string_lossy().into_owned(),
                args: vec![LOM_SEARCH_MCP_SUBCOMMAND.to_owned()],
                env: self.env_pairs(),
            },
        }
    }

    pub fn acp_server(&self, binary_path: &Path) -> agent_client_protocol::schema::v1::McpServer {
        use agent_client_protocol::schema::v1::{EnvVariable, McpServer, McpServerStdio};
        let env = self
            .env_pairs()
            .into_iter()
            .map(|(name, value)| EnvVariable::new(name, value))
            .collect();
        McpServer::Stdio(
            McpServerStdio::new(LOM_SEARCH_MCP_SERVER_NAME, binary_path.to_string_lossy().into_owned())
                .args(vec![LOM_SEARCH_MCP_SUBCOMMAND.to_owned()])
                .env(env),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_context::{
        AcpSessionBuildContext, AgentSessionKind, AionrsSessionBuildContext, AntigravitySessionBuildContext,
    };
    use aionui_api_types::AionrsBuildExtra;
    use std::path::PathBuf;

    fn runtime_env() -> Vec<(String, String)> {
        vec![
            (ENV_BASE_URL.to_owned(), "http://127.0.0.1:25808".to_owned()),
            (ENV_USER_ID.to_owned(), "user-1".to_owned()),
            (ENV_CONVERSATION_ID.to_owned(), "conv-1".to_owned()),
            (ENV_RUNTIME_TOKEN.to_owned(), "search-token".to_owned()),
        ]
    }

    #[test]
    fn s06_c_bridge_env_is_complete_and_redacts_the_token() {
        let bridge = SearchBridgeEnv::from_runtime_env(&runtime_env()).expect("bridge env");
        let debug = format!("{bridge:?}");
        assert!(debug.contains("conv-1"));
        assert!(!debug.contains("search-token"));
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn s06_c_bridge_env_requires_every_runtime_value() {
        for missing in [ENV_BASE_URL, ENV_USER_ID, ENV_CONVERSATION_ID, ENV_RUNTIME_TOKEN] {
            let env: Vec<(String, String)> = runtime_env().into_iter().filter(|(key, _)| key != missing).collect();
            assert!(SearchBridgeEnv::from_runtime_env(&env).is_none(), "missing {missing}");
        }
        let blank = vec![(ENV_RUNTIME_TOKEN.to_owned(), "  ".to_owned())];
        assert!(SearchBridgeEnv::from_runtime_env(&blank).is_none());
    }

    #[test]
    fn s06_c_stdio_spec_carries_only_session_runtime_values() {
        let bridge = SearchBridgeEnv::from_runtime_env(&runtime_env()).unwrap();
        let spec = bridge.stdio_spec(&PathBuf::from("/opt/aioncore"));
        assert_eq!(spec.name, LOM_SEARCH_MCP_SERVER_NAME);
        match spec.transport {
            aionui_session::McpTransport::Stdio { command, args, env } => {
                assert_eq!(command, "/opt/aioncore");
                assert_eq!(args, vec![LOM_SEARCH_MCP_SUBCOMMAND.to_owned()]);
                assert_eq!(env, runtime_env());
                assert!(env.iter().all(|(key, _)| key.starts_with("AIONUI_")));
            }
            _ => panic!("expected stdio transport"),
        }
    }

    #[test]
    fn s06_c_acp_server_carries_only_session_runtime_values() {
        let bridge = SearchBridgeEnv::from_runtime_env(&runtime_env()).unwrap();
        let server = bridge.acp_server(&PathBuf::from("/opt/aioncore"));
        let agent_client_protocol::schema::v1::McpServer::Stdio(stdio) = server else {
            panic!("expected stdio server");
        };
        assert_eq!(stdio.name, LOM_SEARCH_MCP_SERVER_NAME);
        assert_eq!(stdio.args, vec![LOM_SEARCH_MCP_SUBCOMMAND.to_owned()]);
        let names: Vec<_> = stdio.env.iter().map(|variable| variable.name.as_str()).collect();
        assert_eq!(
            names,
            vec![ENV_BASE_URL, ENV_USER_ID, ENV_CONVERSATION_ID, ENV_RUNTIME_TOKEN]
        );
    }

    #[test]
    fn s06_c_antigravity_is_not_a_supported_bridge_backend() {
        assert!(!supports_backend("antigravity"));
        for backend in ["claude", "codex", "gemini", "opencode", "custom"] {
            assert!(supports_backend(backend), "{backend}");
        }
    }

    #[test]
    fn s06_c_side_chat_is_denied_search_tools() {
        let side = AgentSessionKind::Aionrs(Box::new(AionrsSessionBuildContext {
            config: AionrsBuildExtra {
                lom_side: Some("parent".to_owned()),
                ..Default::default()
            },
            team: None,
            belongs_to_team: false,
        }));
        assert!(!session_tools_allowed(&side));

        let native = AgentSessionKind::Aionrs(Box::new(AionrsSessionBuildContext {
            config: AionrsBuildExtra::default(),
            team: None,
            belongs_to_team: false,
        }));
        assert!(
            !session_tools_allowed(&native),
            "native in-process tools must not receive the bridge token scope"
        );

        let acp = AgentSessionKind::Acp(Box::new(AcpSessionBuildContext {
            config: Default::default(),
            team: None,
            belongs_to_team: false,
            session_id: None,
            session_snapshot: None,
        }));
        assert!(session_tools_allowed(&acp));

        let agy = AgentSessionKind::Antigravity(Box::new(AntigravitySessionBuildContext {
            config: Default::default(),
            team: None,
            belongs_to_team: false,
            session_id: None,
            session_snapshot: None,
        }));
        assert!(!session_tools_allowed(&agy));
    }
}
