use aionui_ai_agent::RuntimeTokenScope;
use aionui_ai_agent::RuntimeTokenService;
use aionui_ai_agent::lom_search::SearchSessions;
use aionui_api_types::{ApiResponse, lom_search::LomSearchSessionRequest};
use aionui_auth::CurrentUser;
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::put,
};
use std::sync::Arc;

#[derive(Clone)]
struct ConfigureState {
    sessions: Arc<SearchSessions>,
    runtime_tokens: Arc<RuntimeTokenService>,
}

pub fn routes(sessions: Arc<SearchSessions>, runtime_tokens: Arc<RuntimeTokenService>) -> Router {
    Router::new()
        .route("/api/lom/search-session", put(configure))
        .with_state(ConfigureState {
            sessions,
            runtime_tokens,
        })
}

async fn configure(
    State(state): State<ConfigureState>,
    Extension(user): Extension<CurrentUser>,
    headers: HeaderMap,
    Json(req): Json<LomSearchSessionRequest>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, &'static str)> {
    // No runtime-helper, cookie, or unguarded --local access to cloud credentials.
    let expected = std::env::var("LOM_LAUNCH_TOKEN").unwrap_or_default();
    let supplied = headers.get("x-lom-token").and_then(|v| v.to_str().ok()).unwrap_or("");
    if expected.len() < 32
        || supplied.len() != expected.len()
        || supplied
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            != 0
    {
        return Err((StatusCode::FORBIDDEN, "search.desktop_only"));
    }
    let changed = state
        .sessions
        .configure(&user.id, req.session)
        .await
        .map_err(|code| (StatusCode::BAD_GATEWAY, code))?;
    if changed {
        // Login, logout, or a different cloud account: bridge tokens bound to
        // the previous account must stop working immediately. Team/helper
        // capabilities on a shared token remain valid for the local session.
        state
            .runtime_tokens
            .invalidate_user_scope(&user.id, RuntimeTokenScope::SearchCall);
    }
    Ok(Json(ApiResponse::success()))
}
