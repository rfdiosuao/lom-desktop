use super::*;
use axum::{
    Json, Router,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn s05_native_binding_credentials_logout_and_result() {
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let app=Router::new()
        .route("/v1/account/me",get(|h: HeaderMap|async move {
            let who=h.get("authorization").unwrap().to_str().unwrap();
            if who=="Bearer login" {Json(json!({"data":{"account":{"id":"account1"},"gateway":{"key":"model-key"}}}))}
            else {Json(json!({"data":{"account":{"id":"account2"},"gateway":{"key":"key2"}}}))}
        }))
        .route("/v1/lom/search",post(move |h: HeaderMap,Json(b):Json<Value>|{let count=count.clone();async move {
            assert_eq!(h["authorization"],"Bearer login");
            assert!(uuid::Uuid::parse_str(b["request_id"].as_str().unwrap()).is_ok());
            assert_eq!(b["tool"],"search");count.fetch_add(1,Ordering::SeqCst);
            (StatusCode::OK,Json(json!({"success":true,"data":{"result":{"results":[{"url":"https://example.com"}]},"billable":true}})))
        }}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let sessions = Arc::new(SearchSessions {
        cloud: base,
        ..Default::default()
    });
    assert!(sessions.bind("user", "model-key").is_none());
    sessions.configure("user", Some("login".into())).await.unwrap();
    assert!(sessions.bind("other-user", "model-key").is_none());
    assert!(sessions.bind("user", "other-provider-key").is_none());
    let binding = sessions.bind("user", "model-key").unwrap();
    let mut registry = ToolRegistry::new();
    binding.clone().register(&mut registry);
    assert_eq!(
        registry.tool_names(),
        vec!["LomSkillhubUpload", "LomWebSearch", "LomWebFetch"]
    );
    let result = registry
        .get("LomWebSearch")
        .unwrap()
        .execute(json!({"query":"current fact"}))
        .await;
    assert!(!result.is_error);
    assert!(result.content.contains("https://example.com"));
    assert!(!result.content.contains("login"));
    assert!(!format!("{binding:?}").contains("model-key"));
    sessions.configure("user", Some("other-login".into())).await.unwrap();
    assert_eq!(
        binding.call("search", json!({"query":"news"})).await.unwrap_err(),
        "search.account_changed"
    );
    sessions.configure("user", None).await.unwrap();
    assert_eq!(
        binding.call("search", json!({"query":"news"})).await.unwrap_err(),
        "search.signed_out"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    task.abort();
}

#[tokio::test]
async fn s05_logout_during_verification_cannot_restore_credentials() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let e = entered.clone();
    let r = release.clone();
    let app = Router::new().route(
        "/v1/account/me",
        get(move || {
            let e = e.clone();
            let r = r.clone();
            async move {
                e.notify_one();
                r.notified().await;
                Json(json!({"data":{"account":{"id":"a"},"gateway":{"key":"key"}}}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let cloud = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let s = Arc::new(SearchSessions {
        cloud,
        ..Default::default()
    });
    let login = s.clone();
    let pending = tokio::spawn(async move { login.configure("u", Some("session".into())).await });
    entered.notified().await;
    s.configure("u", None).await.unwrap();
    release.notify_one();
    assert_eq!(pending.await.unwrap().unwrap_err(), "search.session_superseded");
    assert!(s.bind("u", "key").is_none());
    server.abort();
}

#[tokio::test]
async fn d29_native_tool_packages_exact_directory_and_returns_cloud_receipt() {
    use base64::Engine;
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let app = Router::new()
        .route("/v1/account/me", get(|| async { Json(json!({"data":{"account":{"id":"a"},"gateway":{"key":"lom-key"}}})) }))
        .route("/v1/skills",post(move |h:HeaderMap,Json(b):Json<Value>|{let count=count.clone();async move {
            assert_eq!(h["authorization"],"Bearer session");
            assert!(b.get("directory").is_none());
            let bytes=base64::engine::general_purpose::STANDARD.decode(b["archive"].as_str().unwrap()).unwrap();
            let mut z=zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
            let mut text=String::new(); use std::io::Read;
            z.by_name("SKILL.md").unwrap().read_to_string(&mut text).unwrap();
            assert_eq!(text,"# Real skill\nGenerate a report");
            count.fetch_add(1,Ordering::SeqCst);
            Json(json!({"success":true,"data":{"skill_id":"sk_fixture","version_id":"sv_fixture","version":1,"status":"checking"}}))
        }}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let cloud = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let sessions = Arc::new(SearchSessions {
        cloud,
        ..Default::default()
    });
    sessions.configure("user", Some("session".into())).await.unwrap();
    assert!(sessions.bind("user", "byok-key").is_none());
    let mut registry = ToolRegistry::new();
    sessions.bind("user", "lom-key").unwrap().register(&mut registry);
    let tool = registry.get("LomSkillhubUpload").unwrap();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("SKILL.md"), "# Real skill\nGenerate a report").unwrap();
    let input = json!({"directory":dir.path(),"name":"Real skill","summary":"生成报告。","category":"效率"});
    let result = tool.execute(input.clone()).await;
    assert!(!result.is_error, "{}", result.content);
    assert!(result.content.contains("checking"));
    assert!(!result.content.contains("session"));
    sessions.configure("user", None).await.unwrap();
    let failed = tool.execute(input).await;
    assert!(failed.is_error);
    assert_eq!(failed.content, "search.signed_out");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    server.abort();
}

#[tokio::test]
async fn unconfigured_cloud_rejects_login_without_request() {
    let sessions = SearchSessions::with_cloud("");
    assert_eq!(
        sessions.configure("user", Some("test-session".into())).await,
        Err("search.not_configured")
    );
    assert!(!sessions.has_session("user"));
    assert_eq!(sessions.configure("user", None).await, Ok(false));
}
