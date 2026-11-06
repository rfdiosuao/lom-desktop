use super::*;
use axum::{
    Json, Router,
    extract::{Form, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

#[derive(Default)]
struct MemoryStore(Mutex<HashMap<String, Grant>>);
impl SecretStore for MemoryStore {
    fn load(&self, key: &str) -> Result<Option<Grant>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
    fn save(&self, key: &str, grant: Option<&Grant>) -> Result<()> {
        let mut rows = self.0.lock().unwrap();
        if let Some(grant) = grant {
            rows.insert(key.into(), grant.clone());
        } else {
            rows.remove(key);
        }
        Ok(())
    }
}
#[derive(Default)]
struct Remote {
    root: String,
    registration: Mutex<Value>,
    authorization: Mutex<HashMap<String, String>>,
    tokens: AtomicUsize,
    calls: AtomicUsize,
    reject_refresh: AtomicBool,
}
async fn protected(State(s): State<Arc<Remote>>) -> Json<Value> {
    Json(json!({"resource":format!("{}/mcp",s.root),"authorization_servers":[s.root]}))
}
async fn metadata(State(s): State<Arc<Remote>>) -> Json<Value> {
    Json(
        json!({"authorization_endpoint":format!("{}/authorize",s.root),"token_endpoint":format!("{}/token",s.root),"registration_endpoint":format!("{}/register",s.root),"code_challenge_methods_supported":["S256"]}),
    )
}
async fn register(State(s): State<Arc<Remote>>, Json(body): Json<Value>) -> Json<Value> {
    assert_eq!(body["token_endpoint_auth_method"], "none");
    assert_eq!(body["client_name"], "Lom");
    *s.registration.lock().unwrap() = body;
    Json(json!({"client_id":"registered-client","token_endpoint_auth_method":"none"}))
}
async fn authorize(State(s): State<Arc<Remote>>, Query(p): Query<HashMap<String, String>>) -> Redirect {
    assert_eq!(p["client_id"], "registered-client");
    assert_eq!(p["scope"], "mcp");
    assert_eq!(p["code_challenge_method"], "S256");
    assert_eq!(p["redirect_uri"], s.registration.lock().unwrap()["redirect_uris"][0]);
    *s.authorization.lock().unwrap() = p.clone();
    let mut target = reqwest::Url::parse(&p["redirect_uri"]).unwrap();
    target
        .query_pairs_mut()
        .append_pair("code", "fixture-code")
        .append_pair("state", &p["state"]);
    Redirect::temporary(target.as_str())
}
async fn token(State(s): State<Arc<Remote>>, Form(p): Form<HashMap<String, String>>) -> axum::response::Response {
    assert_eq!(p["client_id"], "registered-client");
    assert_eq!(p["resource"], format!("{}/mcp", s.root));
    if p["grant_type"] == "authorization_code" {
        assert_eq!(p["code"], "fixture-code");
        let a = s.authorization.lock().unwrap();
        assert_eq!(p["redirect_uri"], a["redirect_uri"]);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(p["code_verifier"].as_bytes())),
            a["code_challenge"]
        );
    } else {
        if s.reject_refresh.load(Ordering::SeqCst) {
            return (StatusCode::BAD_REQUEST, Json(json!({"error":"SECRET-DO-NOT-RETURN"}))).into_response();
        }
        assert_eq!(
            p["refresh_token"],
            format!("refresh-{}", s.tokens.load(Ordering::SeqCst))
        );
    }
    let generation = s.tokens.fetch_add(1, Ordering::SeqCst) + 1;
    Json(json!({"access_token":format!("access-{generation}"),"token_type":"Bearer","expires_in":900,"refresh_token":format!("refresh-{generation}")})).into_response()
}
async fn mcp(State(s): State<Arc<Remote>>, headers: HeaderMap, Json(body): Json<Value>) -> axum::response::Response {
    assert_eq!(
        headers["authorization"],
        format!("Bearer access-{}", s.tokens.load(Ordering::SeqCst))
    );
    s.calls.fetch_add(1, Ordering::SeqCst);
    if body["method"] == "tools/call" {
        return (StatusCode::INTERNAL_SERVER_ERROR, "SECRET-DO-NOT-RETURN").into_response();
    }
    if body["method"] == "notifications/initialized" {
        return StatusCode::ACCEPTED.into_response();
    }
    if body["method"] == "initialize" {
        return Json(json!({"jsonrpc":"2.0","id":body["id"],"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}})).into_response();
    }
    assert_eq!(headers["mcp-protocol-version"], "2025-03-26");
    let message = json!({"jsonrpc":"2.0","id":body["id"],"result":{"tools":[{"name":"read_only_fixture","inputSchema":{"type":"object"}}]}});
    (
        [("content-type", "text/event-stream")],
        format!("event: message\ndata: {message}\n\n"),
    )
        .into_response()
}
async fn fixture() -> (OAuthClient, Arc<MemoryStore>, Arc<Remote>, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let remote = Arc::new(Remote {
        root,
        ..Default::default()
    });
    let router = Router::new()
        .route("/.well-known/oauth-protected-resource/mcp", get(protected))
        .route("/.well-known/oauth-authorization-server", get(metadata))
        .route("/register", post(register))
        .route("/authorize", get(authorize))
        .route("/token", post(token))
        .route("/mcp", post(mcp))
        .with_state(remote.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let store = Arc::new(MemoryStore::default());
    let mut client = OAuthClient::new(store.clone()).unwrap();
    client.allow_loopback = true;
    (client, store, remote, task)
}
async fn logged_in() -> (OAuthClient, Arc<MemoryStore>, Arc<Remote>, tokio::task::JoinHandle<()>) {
    let (client, store, remote, task) = fixture().await;
    let url = format!("{}/mcp", remote.root);
    let pending = client.prepare(&url).await.unwrap();
    let response = client.http.get(&pending.authorization_url).send().await.unwrap();
    let callback = response.headers()["location"].to_str().unwrap().to_owned();
    let copy = client.clone();
    let finish = tokio::spawn(async move { copy.finish("owner", pending, CancelFlag::default()).await });
    let mut wrong = reqwest::Url::parse(&callback).unwrap();
    wrong.set_query(Some("code=bad&state=wrong"));
    assert_eq!(client.http.get(wrong).send().await.unwrap().status(), 400);
    assert_eq!(client.http.get(callback).send().await.unwrap().status(), 200);
    finish.await.unwrap().unwrap();
    assert!(client.has_grant("owner", &url).unwrap());
    assert!(!client.has_grant("other", &url).unwrap());
    (client, store, remote, task)
}
#[tokio::test]
async fn mcp_oauth_01_pkce_registration_real_callback_refresh_and_sse_forward() {
    let (client, store, remote, task) = logged_in().await;
    let url = format!("{}/mcp", remote.root);
    let key = store::key("owner", &url);
    let mut grant = store.load(&key).unwrap().unwrap();
    assert_eq!(grant.client_id, "registered-client");
    grant.expires_at = now();
    store.save(&key, Some(&grant)).unwrap();
    let mut state = WireState::default();
    client
        .forward(
            "owner",
            &url,
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
            &mut state,
        )
        .await
        .unwrap();
    let out = client
        .forward(
            "owner",
            &url,
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
            &mut state,
        )
        .await
        .unwrap();
    assert_eq!(out[0]["result"]["tools"][0]["name"], "read_only_fixture");
    assert_eq!(
        store.load(&key).unwrap().unwrap().refresh_token.as_deref(),
        Some("refresh-2")
    );
    assert_eq!(remote.tokens.load(Ordering::SeqCst), 2);
    client.revoke_local("owner", &url).await.unwrap();
    assert_eq!(
        client.token("owner", &url).await.unwrap_err().0,
        "mcp.oauth.login_required"
    );
    task.abort();
}
#[tokio::test]
async fn mcp_oauth_01_expired_refresh_failure_is_closed_and_never_replays_a_post() {
    let (client, store, remote, task) = logged_in().await;
    let url = format!("{}/mcp", remote.root);
    let key = store::key("owner", &url);
    let mut state = WireState::default();
    let error = client
        .forward(
            "owner",
            &url,
            &json!({"jsonrpc":"2.0","id":1,"method":"tools/call"}),
            &mut state,
        )
        .await
        .unwrap_err();
    assert_eq!(error.0, "mcp.oauth.outcome_unknown");
    assert!(!error.to_string().contains("SECRET"));
    assert_eq!(remote.calls.load(Ordering::SeqCst), 1);
    let mut grant = store.load(&key).unwrap().unwrap();
    grant.expires_at = now();
    store.save(&key, Some(&grant)).unwrap();
    remote.reject_refresh.store(true, Ordering::SeqCst);
    assert_eq!(
        client.token("owner", &url).await.unwrap_err().0,
        "mcp.oauth.refresh_rejected"
    );
    assert_eq!(remote.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        client.token("other", &url).await.unwrap_err().0,
        "mcp.oauth.login_required"
    );
    task.abort();
}
#[tokio::test]
async fn mcp_oauth_01_concurrent_helpers_refresh_once_and_preserve_rotated_token() {
    let (client, store, remote, task) = logged_in().await;
    let url = format!("{}/mcp", remote.root);
    let key = store::key("owner", &url);
    let mut grant = store.load(&key).unwrap().unwrap();
    grant.expires_at = now();
    store.save(&key, Some(&grant)).unwrap();
    let (a, b) = tokio::join!(client.token("owner", &url), client.token("owner", &url));
    assert_eq!(a.unwrap(), "access-2");
    assert_eq!(b.unwrap(), "access-2");
    assert_eq!(remote.tokens.load(Ordering::SeqCst), 2);
    task.abort();
}
#[tokio::test]
async fn mcp_oauth_01_cancel_does_not_save_credentials() {
    let (client, store, remote, task) = fixture().await;
    let url = format!("{}/mcp", remote.root);
    let pending = client.prepare(&url).await.unwrap();
    let flag = CancelFlag::default();
    flag.cancel();
    assert_eq!(
        client.finish("owner", pending, flag).await.unwrap_err().0,
        "mcp.oauth.cancelled"
    );
    assert!(store.0.lock().unwrap().is_empty());
    assert_eq!(remote.tokens.load(Ordering::SeqCst), 0);
    task.abort();
}
#[test]
fn mcp_oauth_01_untrusted_urls_and_cross_origin_endpoints_are_rejected() {
    for url in [
        "http://example.com/mcp",
        "https://user:password@example.com/mcp",
        "https://example.com/mcp?token=secret",
        "https://example.com/mcp#token",
    ] {
        assert!(discovery::resource(url, false).is_err());
    }
    assert_eq!(
        discovery::same_origin("https://example.com/mcp", "https://evil.invalid/token", false)
            .unwrap_err()
            .0,
        "mcp.oauth.cross_origin_unsupported"
    );
}

#[tokio::test]
async fn mcp_oauth_01_stdio_wire_roundtrip_forwards_initialize_notifications_and_tools() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (client, _store, remote, task) = logged_in().await;
    let url = format!("{}/mcp", remote.root);
    let (test, adapter) = tokio::io::duplex(8192);
    let (input, output) = tokio::io::split(adapter);
    let bridge =
        tokio::spawn(async move { forward::pipe(&client, "owner", &url, BufReader::new(input), output).await });
    let (reader, mut writer) = tokio::io::split(test);
    let mut reader = BufReader::new(reader);
    for body in [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    ] {
        writer.write_all((body.to_string() + "\n").as_bytes()).await.unwrap();
    }
    writer.shutdown().await.unwrap();
    let mut first = String::new();
    reader.read_line(&mut first).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&first).unwrap()["id"], 1);
    let mut second = String::new();
    reader.read_line(&mut second).await.unwrap();
    let result: Value = serde_json::from_str(&second).unwrap();
    assert_eq!(result["id"], 2);
    assert_eq!(result["result"]["tools"][0]["name"], "read_only_fixture");
    assert!(!first.contains("access-"));
    assert!(!second.contains("refresh-"));
    assert_eq!(remote.calls.load(Ordering::SeqCst), 3);
    bridge.await.unwrap().unwrap();
    task.abort();
}

#[test]
fn mcp_oauth_01_manual_auth_and_loopback_transports_remain_unchanged() {
    let headers = HashMap::from([("Authorization".to_owned(), "manual-fixture".to_owned())]);
    assert!(helper("owner", "https://example.com/mcp", &headers).unwrap().is_none());
    assert!(
        helper("owner", "http://127.0.0.1:1234/mcp", &HashMap::new())
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn mcp_oauth_01_provider_denial_never_exchanges_or_persists_tokens() {
    let (client, store, remote, task) = fixture().await;
    let pending = client.prepare(&format!("{}/mcp", remote.root)).await.unwrap();
    let auth = reqwest::Url::parse(&pending.authorization_url).unwrap();
    let params: HashMap<_, _> = auth.query_pairs().into_owned().collect();
    let mut callback = reqwest::Url::parse(&params["redirect_uri"]).unwrap();
    callback
        .query_pairs_mut()
        .append_pair("state", &params["state"])
        .append_pair("error", "access_denied");
    let copy = client.clone();
    let finish = tokio::spawn(async move { copy.finish("owner", pending, CancelFlag::default()).await });
    client.http.get(callback).send().await.unwrap();
    assert_eq!(finish.await.unwrap().unwrap_err().0, "mcp.oauth.denied");
    assert_eq!(remote.tokens.load(Ordering::SeqCst), 0);
    assert!(store.0.lock().unwrap().is_empty());
    task.abort();
}

/// Explicitly opt-in after the owner has completed real provider authorization.
/// Only renews the same existing grant and reads the remote tools/list endpoint.
#[tokio::test]
#[ignore = "requires an existing OS-stored grant and explicit LOM_MCP_OAUTH_LIVE_URL"]
async fn mcp_oauth_01_live_existing_grant_refresh_and_tools_list() {
    let url = std::env::var("LOM_MCP_OAUTH_LIVE_URL").expect("set the authorized MCP resource URL");
    let user = std::env::var("LOM_MCP_OAUTH_LIVE_USER").expect("set the existing core owner ID");
    let client = OAuthClient::desktop().unwrap();
    let key = store::key(&user, &url);
    let before;
    {
        let _lock = lock(&key).await.unwrap();
        before = client.store.load(&key).unwrap().expect("authorize first");
        let mut expired = before.clone();
        expired.expires_at = now();
        client.store.save(&key, Some(&expired)).unwrap();
    }
    // No token values in assertions, diagnostics or results.
    if let Err(e) = client.token(&user, &url).await {
        panic!("real token renewal failed: {}", e.0);
    }
    let after = client.store.load(&key).unwrap().unwrap();
    assert!(after.expires_at > now() + 60, "renewed expiry missing");
    let mut wire = WireState::default();
    assert!(client.forward(&user,&url,&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"Lom OAuth read-only validation","version":"1"}}}),&mut wire).await.is_ok());
    assert!(
        client
            .forward(
                &user,
                &url,
                &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
                &mut wire
            )
            .await
            .is_ok()
    );
    let tools = client
        .forward(
            &user,
            &url,
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
            &mut wire,
        )
        .await
        .unwrap();
    let count = tools
        .iter()
        .find_map(|v| v["result"]["tools"].as_array())
        .expect("tools/list missing")
        .len();
    assert!(count > 0, "no tools returned");
    println!(
        "MCP_OAUTH_LIVE renewed=true access_changed={} refresh_changed={} tools={count}",
        before.access_token != after.access_token,
        before.refresh_token != after.refresh_token
    );
}
