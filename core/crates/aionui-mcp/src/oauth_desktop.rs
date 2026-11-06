#![allow(clippy::disallowed_types)] // HTTP route boundary; domain logic lives in lom-mcp-oauth.
//! MCP-OAUTH-01: desktop-only OAuth UI routes. The legacy API is not used.
use crate::routes::McpRouterState;
use aionui_api_types::ApiResponse;
use aionui_auth::CurrentUser;
use aionui_common::ApiError;
use axum::{
    Extension, Json, Router,
    extract::State,
    routing::{get, post},
};
use lom_mcp_oauth::{CancelFlag, OAuthClient};
use serde::Deserialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub struct OAuthFlows(Arc<Mutex<FlowState>>);
#[derive(Default)]
struct FlowState {
    pending: HashMap<(String, String), CancelFlag>,
    cancelled: VecDeque<(String, String)>,
}
struct FlowLease {
    flows: OAuthFlows,
    key: (String, String),
    flag: CancelFlag,
}
impl Drop for FlowLease {
    fn drop(&mut self) {
        self.flag.cancel();
        if let Ok(mut flows) = self.flows.0.lock() {
            flows.pending.remove(&self.key);
        }
    }
}
impl OAuthFlows {
    fn begin(&self, user: &str, id: String, flag: CancelFlag) -> Result<FlowLease, ApiError> {
        let key = (user.to_owned(), id);
        let mut flows = self
            .0
            .lock()
            .map_err(|_| ApiError::Internal("mcp.oauth.state_unavailable".into()))?;
        if flows.cancelled.contains(&key) {
            return Err(fail(lom_mcp_oauth::Error("mcp.oauth.cancelled")));
        }
        if flows.pending.keys().any(|(u, _)| u == user) {
            return Err(ApiError::BadRequest("mcp.oauth.busy".into()));
        }
        flows.pending.insert(key.clone(), flag.clone());
        Ok(FlowLease {
            flows: self.clone(),
            key,
            flag,
        })
    }
    fn cancel(&self, user: &str, id: String) -> Result<(), ApiError> {
        let mut flows = self
            .0
            .lock()
            .map_err(|_| ApiError::Internal("mcp.oauth.state_unavailable".into()))?;
        let key = (user.to_owned(), id);
        if let Some(flag) = flows.pending.get(&key) {
            flag.cancel();
        } else {
            if flows.cancelled.len() >= 128 {
                flows.cancelled.pop_front();
            }
            flows.cancelled.push_back(key);
        }
        Ok(())
    }
}
#[derive(Deserialize)]
struct Request {
    server_id: String,
    request_id: Option<String>,
}
fn enabled() -> bool {
    lom_mcp_oauth::store::supported() && std::env::var_os("LOM_LAUNCH_TOKEN").is_some()
}
fn fail(e: lom_mcp_oauth::Error) -> ApiError {
    ApiError::BadRequest(e.0.to_owned())
}
fn client() -> Result<OAuthClient, ApiError> {
    if !enabled() {
        return Err(fail(lom_mcp_oauth::Error("mcp.oauth.update_desktop_core")));
    }
    OAuthClient::desktop().map_err(fail)
}
async fn url(state: &McpRouterState, user: &CurrentUser, id: &str, empty_headers: bool) -> Result<String, ApiError> {
    let row = state
        .config_service
        .get_server(&user.id, id)
        .await
        .map_err(ApiError::from)?;
    if row.builtin {
        return Err(fail(lom_mcp_oauth::Error("mcp.oauth.internal_service")));
    }
    match row.transport {
        aionui_api_types::McpTransport::Http { url, headers } if !empty_headers || headers.is_empty() => Ok(url),
        _ => Err(fail(lom_mcp_oauth::Error("mcp.oauth.http_without_headers_required"))),
    }
}
pub fn routes() -> Router<McpRouterState> {
    Router::new()
        .route("/api/mcp/oauth/v2/capabilities", get(capabilities))
        .route("/api/mcp/oauth/v2/status", post(status))
        .route("/api/mcp/oauth/v2/login", post(login))
        .route("/api/mcp/oauth/v2/cancel", post(cancel))
        .route("/api/mcp/oauth/v2/logout", post(logout))
}
async fn capabilities() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(
        serde_json::json!({"version":1,"supported":enabled(),"transport":"http","store":"os-secret-store","refresh":"per-request"}),
    ))
}
async fn status(
    State(state): State<McpRouterState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<Request>,
) -> Result<Json<ApiResponse<serde_json::Value>>, ApiError> {
    let resource = url(&state, &user, &req.server_id, false).await?;
    let authenticated = client()?.has_grant(&user.id, &resource).map_err(fail)?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"authenticated":authenticated}),
    )))
}
async fn login(
    State(state): State<McpRouterState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<Request>,
) -> Result<Json<ApiResponse<serde_json::Value>>, ApiError> {
    let resource = url(&state, &user, &req.server_id, true).await?;
    let client = client()?;
    let request = req
        .request_id
        .filter(|v| v.len() >= 16 && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        .ok_or(ApiError::BadRequest("mcp.oauth.invalid_request_id".into()))?;
    let flag = CancelFlag::default();
    let _lease = state.oauth_flows.begin(&user.id, request, flag.clone())?;
    tracing::info!("MCP OAuth authorization started");
    let result = async {
        let pending = client.prepare(&resource).await?;
        flag.check()?;
        open::that(&pending.authorization_url).map_err(|_| lom_mcp_oauth::Error("mcp.oauth.browser_failed"))?;
        client.finish(&user.id, pending, flag).await
    }
    .await;
    match result {
        Ok(()) => tracing::info!("MCP OAuth authorization completed"),
        Err(e) => tracing::warn!(code = e.0, "MCP OAuth authorization failed"),
    }
    result.map_err(fail)?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"success":true}))))
}
async fn cancel(
    State(state): State<McpRouterState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<Request>,
) -> Result<Json<ApiResponse<serde_json::Value>>, ApiError> {
    let id = req
        .request_id
        .filter(|v| v.len() >= 16 && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        .ok_or(ApiError::BadRequest("mcp.oauth.invalid_request_id".into()))?;
    state.oauth_flows.cancel(&user.id, id)?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"success":true}))))
}
async fn logout(
    State(state): State<McpRouterState>,
    Extension(user): Extension<CurrentUser>,
    Json(req): Json<Request>,
) -> Result<Json<ApiResponse<serde_json::Value>>, ApiError> {
    let resource = url(&state, &user, &req.server_id, false).await?;
    {
        let pending = state
            .oauth_flows
            .0
            .lock()
            .map_err(|_| ApiError::Internal("mcp.oauth.state_unavailable".into()))?;
        if pending.pending.keys().any(|(id, _)| id == &user.id) {
            return Err(ApiError::BadRequest("mcp.oauth.busy".into()));
        }
    }
    client()?.revoke_local(&user.id, &resource).await.map_err(fail)?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"success":true}))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mcp_oauth_01_cancel_before_login_and_dropped_handlers_do_not_leave_busy_state() {
        let flows = OAuthFlows::default();
        let flag = CancelFlag::default();
        flows.cancel("owner", "cancelled-request".into()).unwrap();
        assert!(flows.begin("owner", "cancelled-request".into(), flag.clone()).is_err());
        let lease = flows.begin("owner", "first-request".into(), flag.clone()).unwrap();
        assert!(
            flows
                .begin("owner", "second-request".into(), CancelFlag::default())
                .is_err()
        );
        flows.cancel("other", "first-request".into()).unwrap();
        assert!(flag.check().is_ok());
        drop(lease);
        assert_eq!(flag.check().unwrap_err().0, "mcp.oauth.cancelled");
        assert!(
            flows
                .begin("owner", "next-request".into(), CancelFlag::default())
                .is_ok()
        );
    }
}
