//! Desktop-local archive endpoints. Never exposed through login or runtime helper tokens.
use aionui_api_types::{ApiResponse, history_import::*};
use aionui_history::{HistoryError, HistoryStore};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

type Store = Arc<Mutex<HistoryStore>>;
type Failure = (StatusCode, Json<serde_json::Value>);
fn failure(error: impl std::fmt::Display) -> Failure {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({"success":false,"error":error.to_string(),"code":"history.operation_failed"})),
    )
}
pub fn routes(data: PathBuf) -> Router {
    let Some(guard) = lom_launch_guard::LaunchGuard::from_env() else {
        return Router::new();
    };
    let Some(home) = dirs::home_dir() else {
        return Router::new();
    };
    let state = Arc::new(Mutex::new(HistoryStore::new(home, data.join("cli-history-v1"))));
    guard.apply(history_routes(state))
}
fn history_routes(state: Store) -> Router {
    Router::new()
        .route("/api/lom/history/scan", post(scan))
        .route("/api/lom/history/import", post(import))
        .route("/api/lom/history", get(list))
        .route("/api/lom/history/{id}", get(page))
        .route("/api/lom/history/{id}/bundle", post(bundle))
        .with_state(state)
}
async fn work<T: Send + 'static>(
    s: Store,
    f: impl FnOnce(&HistoryStore) -> Result<T, HistoryError> + Send + 'static,
) -> Result<Json<ApiResponse<T>>, Failure> {
    let result = tokio::task::spawn_blocking(move || {
        let guard = s.lock().map_err(|_| HistoryError::Invalid("store_poisoned"))?;
        f(&guard)
    })
    .await
    .map_err(|_| failure("history.worker_failed"))?
    .map_err(failure)?;
    Ok(Json(ApiResponse::ok(result)))
}
async fn scan(
    State(s): State<Store>,
    Json(req): Json<HistoryScanRequest>,
) -> Result<Json<ApiResponse<HistoryListing>>, Failure> {
    if req.sources.is_empty() || req.sources.len() > 2 {
        return Err(failure("history.invalid_sources"));
    }
    work(s, move |st| st.scan(&req.sources)).await
}
async fn import(
    State(s): State<Store>,
    Json(req): Json<HistoryImportRequest>,
) -> Result<Json<ApiResponse<HistoryImportResult>>, Failure> {
    work(s, move |st| st.import(&req.entries)).await
}
async fn list(State(s): State<Store>) -> Result<Json<ApiResponse<HistoryListing>>, Failure> {
    work(s, HistoryStore::list).await
}
#[derive(Deserialize)]
struct Pagination {
    #[serde(default)]
    offset: usize,
}
async fn page(
    State(s): State<Store>,
    Path(id): Path<String>,
    Query(p): Query<Pagination>,
) -> Result<Json<ApiResponse<HistoryPage>>, Failure> {
    work(s, move |st| st.page(&id, p.offset)).await
}

async fn bundle(State(s): State<Store>, Path(id): Path<String>) -> Result<Json<ApiResponse<HistoryBundle>>, Failure> {
    work(s, move |st| st.bundle(&id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    #[tokio::test]
    async fn hist01_desktop_guard_rejects_missing_token() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Mutex::new(HistoryStore::new(
            dir.path().into(),
            dir.path().join("archive"),
        )));
        let guard = lom_launch_guard::LaunchGuard::new(&"a".repeat(40), "").unwrap();
        let router = guard.apply(history_routes(store));
        let denied = router
            .clone()
            .oneshot(Request::builder().uri("/api/lom/history").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        let allowed = router
            .oneshot(
                Request::builder()
                    .uri("/api/lom/history")
                    .header("x-lom-token", "a".repeat(40))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
    }
}
