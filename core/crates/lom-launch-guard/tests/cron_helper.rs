use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::{get, post, put},
};
use lom_launch_guard::LaunchGuard;
use tower::ServiceExt;

fn app() -> Router {
    let router = Router::new()
        .route("/api/internal/conversation-cron/list", get(|| async { "ok" }))
        .route("/api/internal/conversation-cron/create", post(|| async { "ok" }))
        .route("/api/internal/conversation-cron/jobs/{id}", put(|| async { "ok" }))
        .route("/api/providers", get(|| async { "secret" }));
    LaunchGuard::new("0123456789abcdef0123456789abcdef", "")
        .unwrap()
        .with_cron_helper_verifier(|token, user, conversation| {
            token == "live-helper" && user == "owner" && conversation == "current"
        })
        .apply(router)
}

async fn status(method: &str, path: &str, token: &str, user: &str, conversation: &str) -> StatusCode {
    app()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-aionui-runtime-token", token)
                .header("x-aionui-user-id", user)
                .header("x-aionui-conversation-id", conversation)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn cron_helper_can_list_create_update_without_desktop_secret() {
    for (method, path) in [
        ("GET", "/api/internal/conversation-cron/list"),
        ("POST", "/api/internal/conversation-cron/create"),
        ("PUT", "/api/internal/conversation-cron/jobs/job-1"),
    ] {
        assert_eq!(
            status(method, path, "live-helper", "owner", "current").await,
            StatusCode::OK
        );
    }
}

#[tokio::test]
async fn cron_helper_rejects_missing_forged_revoked_or_misbound_credentials() {
    for (token, user, conversation) in [
        ("", "owner", "current"),
        ("revoked", "owner", "current"),
        ("live-helper", "other", "current"),
        ("live-helper", "owner", "other"),
    ] {
        assert_eq!(
            status(
                "POST",
                "/api/internal/conversation-cron/create",
                token,
                user,
                conversation
            )
            .await,
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn helper_does_not_unlock_general_apis_or_unlisted_methods() {
    for (method, path) in [
        ("GET", "/api/providers"),
        ("DELETE", "/api/internal/conversation-cron/jobs/job-1"),
        ("PUT", "/api/internal/conversation-cron/jobs/job-1/other"),
    ] {
        assert_eq!(
            status(method, path, "live-helper", "owner", "current").await,
            StatusCode::UNAUTHORIZED
        );
    }
}
