use super::*;
use axum::body::Body;
use axum::http::Request;
use axum::routing::{get, post};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

async fn mock_cloud(status: StatusCode, reply: Value) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&calls);
    let app = Router::new()
        .route(
            "/v1/account/me",
            get(|| async { Json(json!({"data":{"account":{"id":"account-1"},"gateway":{"key":"model-key"}}})) }),
        )
        .route(
            "/v1/lom/search",
            post(move |h: HeaderMap, body: Json<Value>| {
                let count = Arc::clone(&count);
                async move {
                    assert_eq!(h["authorization"], "Bearer cloud-login");
                    assert_eq!(body["tool"], "search");
                    assert_eq!(body["arguments"]["query"], "current fact");
                    assert!(uuid::Uuid::parse_str(body["request_id"].as_str().unwrap()).is_ok());
                    count.fetch_add(1, Ordering::SeqCst);
                    (status, Json(reply))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, calls, task)
}

fn app(state: RuntimeLomSearchState) -> Router {
    runtime_lom_search_routes(state)
}

fn call_request(user: &str, conversation: &str, token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/api/runtime/lom/search/tool")
        .header("content-type", "application/json")
        .header(HEADER_USER_ID, user)
        .header(HEADER_CONVERSATION_ID, conversation);
    if let Some(token) = token {
        builder = builder.header(HEADER_RUNTIME_TOKEN, token);
    }
    builder
        .body(Body::from(
            serde_json::to_vec(&json!({"tool":"search","arguments":{"query":"current fact"}})).unwrap(),
        ))
        .unwrap()
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn configured_sessions(base: String) -> Arc<SearchSessions> {
    let sessions = Arc::new(SearchSessions::with_cloud(base));
    sessions.configure("user-1", Some("cloud-login".into())).await.unwrap();
    sessions
}

#[tokio::test]
async fn s06_c_search_route_uses_account_binding_and_marks_untrusted() {
    let (base, calls, task) = mock_cloud(
        StatusCode::OK,
        json!({"success":true,"data":{"result":{"results":[{"url":"https://example.com"}]},"billable":true}}),
    )
    .await;
    let sessions = configured_sessions(base).await;
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue(
        "user-1",
        "conv-1",
        TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        [RuntimeTokenScope::SearchCall],
    );

    let response = app(RuntimeLomSearchState {
        search: sessions,
        runtime_token_service: tokens,
    })
    .oneshot(call_request("user-1", "conv-1", Some(&issue.token)))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["untrusted_web_content"], true);
    assert_eq!(json["data"]["result"]["results"][0]["url"], "https://example.com");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    task.abort();
}

#[tokio::test]
async fn s06_c_search_route_rejects_helper_and_team_scoped_tokens() {
    let (base, calls, task) = mock_cloud(StatusCode::OK, json!({"success":true,"data":{}})).await;
    let sessions = configured_sessions(base).await;

    for scopes in [
        vec![RuntimeTokenScope::ConversationHelper],
        vec![RuntimeTokenScope::TeamContext, RuntimeTokenScope::TeamCall],
    ] {
        let tokens = Arc::new(RuntimeTokenService::new());
        let issue = tokens.issue("user-1", "conv-1", TEAM_RUNTIME_TOKEN_SESSION_GENERATION, scopes);
        let response = app(RuntimeLomSearchState {
            search: sessions.clone(),
            runtime_token_service: tokens,
        })
        .oneshot(call_request("user-1", "conv-1", Some(&issue.token)))
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let json = body_json(response).await;
        assert_eq!(json["error"]["code"], "search.runtime_auth_failed");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn s06_c_search_route_rejects_a_different_generation() {
    let (base, calls, task) = mock_cloud(StatusCode::OK, json!({"success":true,"data":{}})).await;
    let sessions = configured_sessions(base).await;
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue("user-1", "conv-1", "generation-2", [RuntimeTokenScope::SearchCall]);

    let response = app(RuntimeLomSearchState {
        search: sessions,
        runtime_token_service: tokens,
    })
    .oneshot(call_request("user-1", "conv-1", Some(&issue.token)))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(response).await["error"]["code"], "search.runtime_auth_failed");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn s06_c_search_route_fails_after_account_switch() {
    let (base, calls, task) = mock_cloud(StatusCode::OK, json!({"success":true,"data":{}})).await;
    let sessions = configured_sessions(base.clone()).await;
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue(
        "user-1",
        "conv-1",
        TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        [
            RuntimeTokenScope::SearchCall,
            RuntimeTokenScope::TeamCall,
            RuntimeTokenScope::ConversationHelper,
        ],
    );
    // The configure route does exactly this when the verified account changes.
    sessions.configure("user-1", Some("other-login".into())).await.unwrap();
    tokens.invalidate_user_scope("user-1", RuntimeTokenScope::SearchCall);

    let response = app(RuntimeLomSearchState {
        search: sessions,
        runtime_token_service: tokens,
    })
    .oneshot(call_request("user-1", "conv-1", Some(&issue.token)))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(response).await["error"]["code"], "search.runtime_auth_failed");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn s06_c_search_route_rejects_tools_outside_the_public_pair() {
    let (base, calls, task) = mock_cloud(StatusCode::OK, json!({"success":true,"data":{}})).await;
    let sessions = configured_sessions(base).await;
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue(
        "user-1",
        "conv-1",
        TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        [RuntimeTokenScope::SearchCall],
    );
    let request = Request::builder()
        .method("POST")
        .uri("/api/runtime/lom/search/tool")
        .header("content-type", "application/json")
        .header(HEADER_USER_ID, "user-1")
        .header(HEADER_CONVERSATION_ID, "conv-1")
        .header(HEADER_RUNTIME_TOKEN, &issue.token)
        .body(Body::from(r#"{"tool":"skill_upload","arguments":{}}"#))
        .unwrap();

    let response = app(RuntimeLomSearchState {
        search: sessions,
        runtime_token_service: tokens,
    })
    .oneshot(request)
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(response).await["error"]["code"], "search.invalid_tool");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn s06_c_search_route_reports_unconfigured_bridge_as_signed_out() {
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue(
        "user-2",
        "conv-1",
        TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        [RuntimeTokenScope::SearchCall],
    );

    let response = app(RuntimeLomSearchState {
        search: Arc::new(SearchSessions::with_cloud("http://127.0.0.1:1")),
        runtime_token_service: tokens,
    })
    .oneshot(call_request("user-2", "conv-1", Some(&issue.token)))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body_json(response).await["error"]["code"], "search.signed_out");
}

#[tokio::test]
async fn s06_c_search_route_reports_unknown_outcome_without_retrying() {
    let (base, calls, task) = mock_cloud(
        StatusCode::OK,
        json!({"success":true,"data":{"result":{},"billable":true}}),
    )
    .await;
    let sessions = configured_sessions(base).await;
    // The cloud disappears after login verification: the bridge call must
    // surface the unknown outcome once, not retry it.
    task.abort();
    let _ = task.await;
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue(
        "user-1",
        "conv-1",
        TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        [RuntimeTokenScope::SearchCall],
    );

    let response = app(RuntimeLomSearchState {
        search: sessions,
        runtime_token_service: tokens,
    })
    .oneshot(call_request("user-1", "conv-1", Some(&issue.token)))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    let json = body_json(response).await;
    assert_eq!(
        json["error"]["code"],
        "search.outcome_unknown: do not automatically repeat this request"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn s06_c_search_route_preserves_cloud_error_code() {
    let (base, calls, task) = mock_cloud(
        StatusCode::TOO_MANY_REQUESTS,
        json!({"success":false,"error":{"code":"search.rate_limited","message":"too many requests"}}),
    )
    .await;
    let sessions = configured_sessions(base).await;
    let tokens = Arc::new(RuntimeTokenService::new());
    let issue = tokens.issue(
        "user-1",
        "conv-1",
        TEAM_RUNTIME_TOKEN_SESSION_GENERATION,
        [RuntimeTokenScope::SearchCall],
    );

    let response = app(RuntimeLomSearchState {
        search: sessions,
        runtime_token_service: tokens,
    })
    .oneshot(call_request("user-1", "conv-1", Some(&issue.token)))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let json = body_json(response).await;
    assert_eq!(json["success"], false);
    assert_eq!(json["error"]["code"], "search.rate_limited");
    assert_eq!(calls.load(Ordering::SeqCst), 1, "cloud rejections must not be retried");
    task.abort();
}
