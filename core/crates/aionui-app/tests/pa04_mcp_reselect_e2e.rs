//! Lom PA04: an existing conversation can re-select its MCP servers through
//! `extra.selected_mcp_server_ids`; core rebuilds the snapshot, clients still
//! cannot write the snapshot keys directly.

mod common;

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use common::{body_json, build_app, get_with_token, json_with_token, setup_and_login};

async fn add_server(app: &axum::Router, token: &str, csrf: &str, name: &str) -> String {
    let body = json!({ "name": name, "transport": { "type": "http", "url": "http://127.0.0.1:9/mcp" } });
    let resp = app
        .clone()
        .oneshot(json_with_token("POST", "/api/mcp/servers", body, token, csrf))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    body_json(resp).await["data"]["id"].as_str().unwrap().to_owned()
}

async fn extra(app: &axum::Router, token: &str, id: &str) -> serde_json::Value {
    let resp = app
        .clone()
        .oneshot(get_with_token(&format!("/api/conversations/{id}"), token))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    body_json(resp).await["data"]["extra"].clone()
}

#[tokio::test]
async fn pa04_patch_reselects_mcp_servers_and_rebuilds_the_snapshot() {
    let (mut app, services) = build_app().await;
    let (token, csrf) = setup_and_login(&mut app, &services, "admin", "StrongP@ss1").await;
    let docs = add_server(&app, &token, &csrf, "docs").await;
    let bridge = add_server(&app, &token, &csrf, "lom-phone-pa-test").await;

    let create = json!({ "type": "acp", "name": "assistant", "extra": { "lom_personal": "pa_a", "selected_mcp_server_ids": [docs] } });
    let resp = app
        .clone()
        .oneshot(json_with_token("POST", "/api/conversations", create, &token, &csrf))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let id = body_json(resp).await["data"]["id"].as_str().unwrap().to_owned();
    assert_eq!(extra(&app, &token, &id).await["mcp_server_ids"], json!([docs]));

    let patch = json!({ "extra": { "lom_personal_scope": "pa-test", "selected_mcp_server_ids": [docs, bridge] } });
    let resp = app
        .clone()
        .oneshot(json_with_token(
            "PATCH",
            &format!("/api/conversations/{id}"),
            patch,
            &token,
            &csrf,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let after = extra(&app, &token, &id).await;
    assert_eq!(after["mcp_server_ids"], json!([docs, bridge]));
    assert_eq!(after["mcp_servers"], json!(["docs", "lom-phone-pa-test"]));
    assert_eq!(after["mcp_statuses"].as_array().unwrap().len(), 2);
    assert!(after.get("selected_mcp_server_ids").is_none());
    // Other extra keys are merged, not replaced.
    assert_eq!(after["lom_personal"], json!("pa_a"));
    assert_eq!(after["lom_personal_scope"], json!("pa-test"));

    // The snapshot itself stays immutable for clients.
    let direct = json!({ "extra": { "mcp_server_ids": [bridge] } });
    let resp = app
        .clone()
        .oneshot(json_with_token(
            "PATCH",
            &format!("/api/conversations/{id}"),
            direct,
            &token,
            &csrf,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert_eq!(extra(&app, &token, &id).await["mcp_server_ids"], json!([docs, bridge]));
}
