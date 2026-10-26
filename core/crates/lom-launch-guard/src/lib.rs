//! Lom launch-token guard for the embedded (`--local`) server.
//!
//! Upstream `--local` mode disables authentication and allows any CORS origin, so any
//! web page open in the user's browser could drive the agent tools on 127.0.0.1.
//! The Lom desktop shell generates a one-time token per launch and passes it through
//! `LOM_LAUNCH_TOKEN`. When it is set:
//!
//! - User-facing routes require the `X-Lom-Token` header. WebSocket and file-stream
//!   requests (where browsers cannot set headers) may pass `token` as a query param.
//!   Anything else gets 401; the comparison is constant-time.
//! - CORS only reflects the Tauri webview origins plus `LOM_ALLOWED_ORIGINS`.
//! - Runtime routes called by agent subprocesses authenticate with their own
//!   conversation-scoped tokens; health and logo assets carry no sensitive data.
//!   Those paths bypass this guard.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    middleware::{self, Next},
    response::Response,
};
use http::{HeaderValue, Method, StatusCode, header};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Header carrying the launch token.
pub const TOKEN_HEADER: &str = "x-lom-token";
/// Minimum token length; guards against an empty or weak token from the shell.
const MIN_TOKEN_LEN: usize = 32;
/// Origins of the Tauri webview across platforms.
const TAURI_ORIGINS: [&str; 3] = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
/// Path prefixes that bypass the guard (see module docs).
const EXEMPT_PREFIXES: [&str; 6] = [
    "/health",
    "/api/runtime/",
    "/internal/",
    "/api/assets/",
    "/api/office-watch-proxy/",
    "/api/ppt-proxy/",
];
/// Paths that may carry the token as a `token` query param instead of a header.
const QUERY_TOKEN_PATHS: [&str; 2] = ["/ws", "/api/fs/stream"];

type HelperVerifier = dyn Fn(&str, &str, &str) -> bool + Send + Sync;

#[derive(Clone)]
pub struct LaunchGuard {
    token: Arc<str>,
    origins: Arc<[HeaderValue]>,
    helper_verifier: Option<Arc<HelperVerifier>>,
}

impl LaunchGuard {
    /// Reads the config from the environment; `None` keeps upstream behavior.
    pub fn from_env() -> Option<Self> {
        let token = std::env::var("LOM_LAUNCH_TOKEN").ok()?;
        let origins = std::env::var("LOM_ALLOWED_ORIGINS").unwrap_or_default();
        Self::new(&token, &origins)
    }

    /// `extra_origins` is a comma-separated list of extra origins (e.g. a dev server).
    pub fn new(token: &str, extra_origins: &str) -> Option<Self> {
        let token = token.trim();
        if token.len() < MIN_TOKEN_LEN {
            tracing::warn!("LOM_LAUNCH_TOKEN is shorter than {MIN_TOKEN_LEN} chars; launch guard disabled");
            return None;
        }
        let origins = TAURI_ORIGINS
            .iter()
            .copied()
            .chain(extra_origins.split(',').map(str::trim).filter(|o| !o.is_empty()))
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect::<Vec<_>>();
        Some(Self {
            token: Arc::from(token),
            origins: Arc::from(origins),
            helper_verifier: None,
        })
    }

    /// Validate the existing conversation-scoped credential for cron helpers.
    /// This does not grant the helper access to other desktop APIs.
    pub fn with_cron_helper_verifier(
        mut self,
        verifier: impl Fn(&str, &str, &str) -> bool + Send + Sync + 'static,
    ) -> Self {
        self.helper_verifier = Some(Arc::new(verifier));
        self
    }

    fn accepts_cron_helper(&self, request: &Request) -> bool {
        let path = request.uri().path();
        let allowed = match *request.method() {
            Method::GET => path == "/api/internal/conversation-cron/list",
            Method::POST => path == "/api/internal/conversation-cron/create",
            Method::PUT => path
                .strip_prefix("/api/internal/conversation-cron/jobs/")
                .is_some_and(|id| !id.is_empty() && !id.contains('/')),
            _ => false,
        };
        if !allowed {
            return false;
        }
        let read = |key| {
            request
                .headers()
                .get(key)
                .and_then(|v| v.to_str().ok())
                .filter(|v| !v.is_empty())
        };
        let (Some(token), Some(user), Some(conversation), Some(verify)) = (
            read("x-aionui-runtime-token"),
            read("x-aionui-user-id"),
            read("x-aionui-conversation-id"),
            self.helper_verifier.as_ref(),
        ) else {
            return false;
        };
        verify(token, user, conversation)
    }

    /// CORS layer that only reflects registered origins.
    pub fn cors_layer(&self) -> CorsLayer {
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(self.origins.iter().cloned()))
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers([
                header::CONTENT_TYPE,
                header::AUTHORIZATION,
                http::HeaderName::from_static(TOKEN_HEADER),
            ])
    }

    /// Wraps `router` with the token check, with CORS outermost so preflights are answered first.
    pub fn apply(&self, router: axum::Router) -> axum::Router {
        router
            .layer(middleware::from_fn_with_state(self.clone(), guard))
            .layer(self.cors_layer())
    }

    fn accepts(&self, request: &Request) -> bool {
        let path = request.uri().path();
        if request.method() == Method::OPTIONS || EXEMPT_PREFIXES.iter().any(|p| path.starts_with(p)) {
            return true;
        }
        if self.accepts_cron_helper(request) {
            return true;
        }
        // WebSocket handshakes are not covered by CORS, so check the browser-supplied Origin here.
        // Non-browser clients (no Origin header) still need the token.
        if path == "/ws"
            && let Some(origin) = request.headers().get(header::ORIGIN)
            && !self.origins.iter().any(|o| o == origin)
        {
            return false;
        }
        let from_header = request.headers().get(TOKEN_HEADER).and_then(|v| v.to_str().ok());
        let from_query = if QUERY_TOKEN_PATHS.contains(&path) {
            query_token(request.uri().query())
        } else {
            None
        };
        from_header
            .or(from_query)
            .is_some_and(|t| constant_time_eq(t.as_bytes(), self.token.as_bytes()))
    }
}

async fn guard(State(g): State<LaunchGuard>, request: Request, next: Next) -> Response {
    if g.accepts(&request) {
        return next.run(request).await;
    }
    tracing::warn!(path = %request.uri().path(), "rejected request without a valid launch token");
    let body = r#"{"success":false,"error":"Missing or invalid launch token","code":"LOM_LAUNCH_TOKEN"}"#;
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn query_token(query: Option<&str>) -> Option<&str> {
    query?.split('&').find_map(|pair| pair.strip_prefix("token="))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, routing::get};
    use tower::ServiceExt;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn app() -> Router {
        let router = Router::new()
            .route("/api/providers", get(|| async { "ok" }))
            .route("/ws", get(|| async { "ok" }))
            .route("/health", get(|| async { "ok" }))
            .route("/api/runtime/team-tools/call", get(|| async { "ok" }));
        LaunchGuard::new(TOKEN, "http://localhost:5173")
            .map(|g| g.apply(router))
            .unwrap_or_default()
    }

    async fn status(req: Request) -> StatusCode {
        app()
            .oneshot(req)
            .await
            .map(|r| r.status())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    }

    fn get_req(uri: &str) -> http::request::Builder {
        Request::builder().method(Method::GET).uri(uri)
    }

    #[tokio::test]
    async fn rejects_missing_and_wrong_tokens() {
        assert_eq!(
            status(get_req("/api/providers").body(Body::empty()).unwrap_or_default()).await,
            StatusCode::UNAUTHORIZED
        );
        let wrong = get_req("/api/providers")
            .header(TOKEN_HEADER, "x".repeat(32))
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(wrong).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn accepts_header_token() {
        let ok = get_req("/api/providers")
            .header(TOKEN_HEADER, TOKEN)
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(ok).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn query_token_only_for_websocket_and_stream() {
        let ws = get_req(&format!("/ws?token={TOKEN}"))
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(ws).await, StatusCode::OK);
        let api = get_req(&format!("/api/providers?token={TOKEN}"))
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(api).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn exempt_paths_pass_without_token() {
        assert_eq!(
            status(get_req("/health").body(Body::empty()).unwrap_or_default()).await,
            StatusCode::OK
        );
        let rt = get_req("/api/runtime/team-tools/call")
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(rt).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn cors_only_reflects_registered_origins() {
        let preflight = |origin: &str| {
            Request::builder()
                .method(Method::OPTIONS)
                .uri("/api/providers")
                .header(header::ORIGIN, origin)
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .body(Body::empty())
                .unwrap_or_default()
        };
        let allowed = app().oneshot(preflight("tauri://localhost")).await.ok();
        let allow = allowed
            .as_ref()
            .and_then(|r| r.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN));
        assert_eq!(allow.and_then(|v| v.to_str().ok()), Some("tauri://localhost"));
        let evil = app().oneshot(preflight("https://evil.example")).await.ok();
        assert!(
            evil.as_ref()
                .and_then(|r| r.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN))
                .is_none()
        );
    }

    #[tokio::test]
    async fn websocket_rejects_unregistered_origin_even_with_token() {
        let evil = get_req(&format!("/ws?token={TOKEN}"))
            .header(header::ORIGIN, "https://evil.example")
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(evil).await, StatusCode::UNAUTHORIZED);
        let tauri = get_req(&format!("/ws?token={TOKEN}"))
            .header(header::ORIGIN, "tauri://localhost")
            .body(Body::empty())
            .unwrap_or_default();
        assert_eq!(status(tauri).await, StatusCode::OK);
    }

    #[test]
    fn short_token_disables_guard() {
        assert!(LaunchGuard::new("short", "").is_none());
    }
}
