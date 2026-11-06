use aion_config::compat::{OpenAiApiMode, ProviderCompat};
use aion_providers::{LlmProvider, openai::OpenAIProvider};
use aion_types::llm::LlmRequest;
use aionui_api_types::AionrsBuildExtra;
use axum::{Json, Router, http::StatusCode, routing::post};
use serde_json::{Value, json};
use tokio::sync::mpsc;

#[tokio::test]
async fn effort_02_none_reaches_chat_and_responses_without_becoming_default() {
    for (mode, path) in [
        (OpenAiApiMode::ChatCompletions, "/chat/completions"),
        (OpenAiApiMode::Responses, "/responses"),
    ] {
        for selected in [Some(" NONE "), None] {
            let (tx, mut rx) = mpsc::channel(4);
            let app = Router::new().route(path, post(move |Json(body): Json<Value>| {
                let tx = tx.clone();
                async move {
                    tx.send(body).await.expect("capture request");
                    (StatusCode::BAD_REQUEST, Json(json!({"error": {"message": "fixture model rejects this request", "type": "invalid_request_error"}})))
                }
            }));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("listen");
            let url = format!("http://{}", listener.local_addr().expect("local address"));
            let server = tokio::spawn(async move {
                axum::serve(listener, app).await.expect("serve");
            });
            let extra: AionrsBuildExtra =
                serde_json::from_value(json!({"reasoning_effort": selected})).expect("conversation extra");
            let request = LlmRequest {
                model: "fixture-model".into(),
                system: String::new(),
                messages: vec![],
                tools: vec![],
                max_tokens: None,
                thinking: None,
                reasoning_effort: super::valid_reasoning_effort(extra.reasoning_effort),
            };
            let mut compat = ProviderCompat::openai_defaults();
            compat.transport.openai_api_mode = Some(mode);
            compat.transport.api_path = Some(path.into());
            let provider = OpenAIProvider::new("fixture-key", &url, compat);
            // Unsupported models must remain a visible provider error, never a silent retry with defaults.
            let error = tokio::time::timeout(std::time::Duration::from_secs(5), provider.stream(&request))
                .await
                .expect("bounded provider request")
                .expect_err("unsupported model");
            assert!(error.to_string().contains("fixture model rejects this request"));
            let body = rx.try_recv().expect("captured request");
            assert!(rx.try_recv().is_err(), "must not replay with another effort");
            server.abort();
            let actual = if path == "/responses" {
                body.pointer("/reasoning/effort")
            } else {
                body.get("reasoning_effort")
            };
            assert_eq!(actual.and_then(Value::as_str), selected.map(|_| "none"));
        }
    }
}
