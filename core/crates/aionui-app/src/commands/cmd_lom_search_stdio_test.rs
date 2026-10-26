use super::*;
use aionui_api_types::lom_search::{LOM_SEARCH_MCP_TOOL_FETCH, LOM_SEARCH_MCP_TOOL_SEARCH};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn server(base_url: String) -> LomSearchStdioServer {
    LomSearchStdioServer::new(LomSearchStdioEnv {
        base_url,
        user_id: "user-1".into(),
        conversation_id: "conv-1".into(),
        runtime_token: "runtime-token-value".into(),
    })
}

async fn mock_bridge(
    reply_status: StatusCode,
    reply: Value,
) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&calls);
    let app = Router::new().route(
        "/api/runtime/lom/search/tool",
        post(move |headers: HeaderMap, _body: Json<Value>| {
            let count = Arc::clone(&count);
            async move {
                assert_eq!(headers["x-aionui-user-id"], "user-1");
                assert_eq!(headers["x-aionui-conversation-id"], "conv-1");
                assert_eq!(headers["x-aionui-runtime-token"], "runtime-token-value");
                assert!(headers.get("authorization").is_none());
                count.fetch_add(1, Ordering::SeqCst);
                (reply_status, Json(reply))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, calls, task)
}

#[test]
fn s06_c_bridge_tools_declare_untrusted_content_and_required_arguments() {
    let tools = LomSearchStdioServer::tool_router().list_all();
    let search = tools
        .iter()
        .find(|tool| tool.name == LOM_SEARCH_MCP_TOOL_SEARCH)
        .unwrap();
    assert_eq!(search.input_schema["required"], json!(["query"]));
    assert_eq!(search.input_schema["properties"]["count"]["minimum"], 10);
    assert_eq!(search.input_schema["properties"]["count"]["maximum"], 50);
    assert!(search.description.as_deref().unwrap().contains("UNTRUSTED"));
    assert!(
        search
            .description
            .as_deref()
            .unwrap()
            .contains("do NOT automatically retry")
    );

    let fetch = tools
        .iter()
        .find(|tool| tool.name == LOM_SEARCH_MCP_TOOL_FETCH)
        .unwrap();
    assert_eq!(fetch.input_schema["required"], json!(["url"]));
    assert!(fetch.description.as_deref().unwrap().contains("UNTRUSTED"));
}

#[tokio::test]
async fn s06_c_bridge_forwards_only_runtime_identity_and_marks_output_untrusted() {
    let (base, calls, task) = mock_bridge(
        StatusCode::OK,
        json!({"success":true,"data":{"source":"Lom web search","untrusted_web_content":true,"result":{"results":[]}}}),
    )
    .await;
    let result = server(base)
        .search(Parameters(SearchParams {
            query: "news".into(),
            count: Some(20),
        }))
        .await;
    assert_eq!(result.is_error, Some(false));
    let payload = result.content[0].as_text().unwrap().text.clone();
    assert!(payload.contains("untrusted_web_content"));
    assert!(!payload.contains("runtime-token-value"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    task.abort();
}

#[tokio::test]
async fn s06_c_bridge_rejects_out_of_range_count_without_calling_the_core() {
    let (base, calls, task) = mock_bridge(StatusCode::OK, json!({"success":true,"data":{}})).await;
    let result = server(base)
        .search(Parameters(SearchParams {
            query: "news".into(),
            count: Some(5),
        }))
        .await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(result.structured_content.unwrap()["code"], ERR_INVALID_ARGUMENTS);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn s06_c_bridge_reports_signed_out_without_leaking_headers() {
    let (base, _calls, task) = mock_bridge(
        StatusCode::UNAUTHORIZED,
        json!({"success":false,"error":{"code":"search.signed_out","message":"Lom search is not configured"}}),
    )
    .await;
    let result = server(base)
        .fetch(Parameters(FetchParams {
            url: "https://example.com/page".into(),
        }))
        .await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(result.structured_content.as_ref().unwrap()["code"], "search.signed_out");
    let rendered = serde_json::to_string(&result).unwrap();
    assert!(!rendered.contains("runtime-token-value"));
    task.abort();
}

#[tokio::test]
async fn s06_c_bridge_rejects_non_http_url_without_calling_the_core() {
    let (base, calls, task) = mock_bridge(StatusCode::OK, json!({"success":true,"data":{}})).await;
    let result = server(base)
        .fetch(Parameters(FetchParams {
            url: "file:///etc/passwd".into(),
        }))
        .await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(result.structured_content.unwrap()["code"], ERR_INVALID_ARGUMENTS);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[test]
fn s06_c_bridge_env_requires_every_runtime_value() {
    assert!(LomSearchStdioEnv::from_values(None, None, None, None).is_err());
    assert!(LomSearchStdioEnv::from_values(Some(" "), Some("u"), Some("c"), Some("t")).is_err());
    let env =
        LomSearchStdioEnv::from_values(Some("http://core"), Some("u"), Some("c"), Some("runtime-token-value")).unwrap();
    assert!(!format!("{env:?}").contains("runtime-token-value"));
    let env = LomSearchStdioEnv::from_values(Some("http://127.0.0.1:25808/"), Some("u"), Some("c"), Some("t")).unwrap();
    assert_eq!(env.base_url, "http://127.0.0.1:25808");
}
