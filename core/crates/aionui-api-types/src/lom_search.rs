use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Reserved MCP server name for the per-conversation Lom search bridge.
pub const LOM_SEARCH_MCP_SERVER_NAME: &str = "lom-search";
/// `aioncore` subcommand that serves the bridge over stdio.
pub const LOM_SEARCH_MCP_SUBCOMMAND: &str = "mcp-lom-search-stdio";
/// MCP tool names exposed to external agents.
pub const LOM_SEARCH_MCP_TOOL_SEARCH: &str = "lom_search";
pub const LOM_SEARCH_MCP_TOOL_FETCH: &str = "lom_fetch";
/// Tool names understood by the cloud search endpoint.
pub const LOM_SEARCH_CLOUD_TOOL_SEARCH: &str = "search";
pub const LOM_SEARCH_CLOUD_TOOL_FETCH: &str = "fetch";

/// Write-only cloud login handoff. Never serialized into runtime configuration.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LomSearchSessionRequest {
    pub session: Option<String>,
}

/// One tool invocation forwarded by the stdio bridge over loopback.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LomSearchToolCallRequest {
    /// Cloud tool name (`search` or `fetch`), never an MCP tool name.
    pub tool: String,
    #[serde(default)]
    pub arguments: Value,
}

/// Loopback reply consumed by the stdio bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LomSearchToolCallResponse {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<LomSearchToolError>,
}

impl LomSearchToolCallResponse {
    pub fn success(data: Value) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn failure(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(LomSearchToolError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LomSearchToolError {
    pub code: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn s06_c_tool_call_request_rejects_unknown_fields() {
        let parsed = serde_json::from_value::<LomSearchToolCallRequest>(json!({
            "tool": "search",
            "arguments": { "query": "x" },
            "session": "must-not-be-accepted"
        }));
        assert!(parsed.is_err());
    }

    #[test]
    fn s06_c_tool_call_response_roundtrip_keeps_error_code() {
        let response = LomSearchToolCallResponse::failure("search.signed_out", "search.signed_out");
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["success"], false);
        assert_eq!(value["error"]["code"], "search.signed_out");

        let parsed: LomSearchToolCallResponse = serde_json::from_value(value).unwrap();
        assert!(!parsed.success);
        assert_eq!(parsed.error.unwrap().code, "search.signed_out");
    }
}
