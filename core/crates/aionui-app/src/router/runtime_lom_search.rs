//! Loopback endpoint for the per-conversation Lom search MCP bridge.
//!
//! The stdio bridge child authenticates with the session runtime token only
//! (`search:call` scope, bound to user + conversation + generation). The cloud
//! login stays in `SearchSessions` inside the core process, so the bridge never
//! sees the account session or a provider key.

use std::sync::Arc;

use aionui_ai_agent::lom_search::SearchSessions;
use aionui_ai_agent::{RuntimeTokenScope, RuntimeTokenService, TEAM_RUNTIME_TOKEN_SESSION_GENERATION};
use aionui_api_types::lom_search::{LomSearchToolCallRequest, LomSearchToolCallResponse};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};

const HEADER_USER_ID: &str = "x-aionui-user-id";
const HEADER_CONVERSATION_ID: &str = "x-aionui-conversation-id";
const HEADER_RUNTIME_TOKEN: &str = "x-aionui-runtime-token";

#[derive(Clone)]
pub struct RuntimeLomSearchState {
    pub search: Arc<SearchSessions>,
    pub runtime_token_service: Arc<RuntimeTokenService>,
}

pub fn runtime_lom_search_routes(state: RuntimeLomSearchState) -> Router {
    Router::new()
        .route("/api/runtime/lom/search/tool", post(call))
        .with_state(state)
}

async fn call(
    State(state): State<RuntimeLomSearchState>,
    headers: HeaderMap,
    Json(request): Json<LomSearchToolCallRequest>,
) -> (StatusCode, Json<LomSearchToolCallResponse>) {
    let Some(runtime) = runtime_identity(&headers, &state.runtime_token_service) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(LomSearchToolCallResponse::failure(
                "search.runtime_auth_failed",
                "runtime auth failed",
            )),
        );
    };
    // Bridge calls bind to the account already verified for this user; the
    // bridge process itself never holds the cloud session or a model key.
    let Some(binding) = state.search.bridge_binding(&runtime.user_id) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(LomSearchToolCallResponse::failure(
                "search.signed_out",
                "Lom search is not configured for this account",
            )),
        );
    };
    match binding.call_tool_outcome(&request.tool, request.arguments).await {
        Ok(data) => (StatusCode::OK, Json(LomSearchToolCallResponse::success(data))),
        Err((code, message)) => (
            status_for_code(&code),
            Json(LomSearchToolCallResponse::failure(code, message)),
        ),
    }
}

struct RuntimeIdentity {
    user_id: String,
}

fn runtime_identity(headers: &HeaderMap, tokens: &RuntimeTokenService) -> Option<RuntimeIdentity> {
    let user_id = required_header(headers, HEADER_USER_ID)?;
    let conversation_id = required_header(headers, HEADER_CONVERSATION_ID)?;
    let token = required_header(headers, HEADER_RUNTIME_TOKEN)?;
    tokens
        .validate(
            Some(&token),
            &user_id,
            &conversation_id,
            RuntimeTokenScope::SearchCall,
            TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        )
        .ok()?;
    Some(RuntimeIdentity { user_id })
}

fn required_header(headers: &HeaderMap, name: &'static str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn status_for_code(code: &str) -> StatusCode {
    match code {
        "search.invalid_tool" => StatusCode::BAD_REQUEST,
        "search.signed_out" | "search.account_changed" => StatusCode::UNAUTHORIZED,
        "search.outcome_unknown: do not automatically repeat this request" => StatusCode::GATEWAY_TIMEOUT,
        "search.invalid_response" => StatusCode::BAD_GATEWAY,
        _ => StatusCode::BAD_GATEWAY,
    }
}

#[cfg(test)]
#[path = "runtime_lom_search_test.rs"]
mod tests;
