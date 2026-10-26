use super::*;
#[test]
fn r02_03_http_mcp_auth_scope_and_tools() {
    let state = Arc::new(Bridge::default());
    state
        .tokens
        .lock()
        .unwrap()
        .insert("conversation-a".into(), "test-capability".into());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let thread = std::thread::spawn(move || {
        for incoming in listener.incoming().take(4) {
            let s = state.clone();
            serve(incoming.unwrap(), state.clone(), move |event| {
                assert_eq!(event.scope, "conversation-a");
                assert_eq!(event.name, "phone_list");
                s.pending
                    .lock()
                    .unwrap()
                    .remove(&event.id)
                    .unwrap()
                    .send(json!({"content":[{"type":"text","text":"real transport receipt"}]}))
                    .unwrap();
                Ok(())
            })
            .unwrap();
        }
    });
    let url = format!("http://127.0.0.1:{port}/mcp");
    let denied = ureq::post(&url).send_json(json!({"id":1,"method":"tools/list"}));
    assert!(matches!(denied, Err(ureq::Error::Status(401, _))));
    let init: Value = ureq::post(&url)
        .set("Authorization", "Bearer test-capability")
        .send_json(json!({"id":2,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}))
        .unwrap()
        .into_json()
        .unwrap();
    assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
    let list: Value = ureq::post(&url)
        .set("Authorization", "Bearer test-capability")
        .send_json(json!({"id":3,"method":"tools/list"}))
        .unwrap()
        .into_json()
        .unwrap();
    let tools = list["result"]["tools"].as_array().unwrap();
    assert!(
        tools.iter().any(|t| t["name"] == "phone_send_image"),
        "image transfer tool is discoverable through MCP"
    );
    assert!(
        tools.iter().any(|t| t["name"] == "lom_view_image"),
        "vision fallback tool is listed"
    );
    let call: Value = ureq::post(&url)
        .set("Authorization", "Bearer test-capability")
        .send_json(
            json!({"id":4,"method":"tools/call","params":{"name":"phone_list","arguments":{}}}),
        )
        .unwrap()
        .into_json()
        .unwrap();
    assert_eq!(
        call["result"]["content"][0]["text"],
        "real transport receipt"
    );
    thread.join().unwrap();
}

/// Runs the shipped core against a local deterministic model; no cloud account or paid tokens.
#[test]
#[ignore = "requires the packaged aioncore binary and Python 3"]
fn r02_03_real_core_model_to_mcp_roundtrip() {
    let state = Arc::new(Bridge::default());
    state
        .tokens
        .lock()
        .unwrap()
        .insert("conversation-a".into(), "test-capability".into());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker_done = done.clone();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let worker_calls = calls.clone();
    let worker = std::thread::spawn(move || {
        while !worker_done.load(std::sync::atomic::Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let s = state.clone();
                    let count = worker_calls.clone();
                    std::thread::spawn(move || {
                        let reply = s.clone();
                        let _ = serve(stream, s, move |event| {
                            assert_eq!(event.scope, "conversation-a");
                            assert_eq!(event.name, "phone_list");
                            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            reply.pending.lock().unwrap().remove(&event.id).unwrap().send(json!({"content":[{"type":"text","text":"[{\"id\":\"fixture-phone\",\"status\":\"online\"}]"}]})).unwrap();
                            Ok(())
                        });
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(e) => panic!("{e}"),
            }
        }
    });
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tools/tests/phone-commander-core.py");
    let result = std::process::Command::new("python3")
        .arg(script)
        .arg(port.to_string())
        .output()
        .unwrap();
    done.store(true, std::sync::atomic::Ordering::SeqCst);
    worker.join().unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    println!("{}", String::from_utf8_lossy(&result.stdout));
}

#[test]
fn feishu_09_personal_scopes_get_session_and_feishu_tools_only() {
    let names = |scope: &str| -> Vec<String> {
        tools(scope)
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        names("pa-0f8e7a52-1c2b-4d3e-9f00-112233445566"),
        [
            "session_list",
            "session_read",
            "session_send",
            "feishu_search_docs",
            "feishu_read_doc",
            "feishu_list_chats",
            "feishu_search_chats",
            "feishu_read_messages",
            "feishu_search_messages",
            "feishu_chat_members",
            "feishu_find_people",
            "feishu_send_message"
        ]
    );
    let commander = names("0f8e7a52-1c2b-4d3e-9f00-112233445566");
    assert!(commander.contains(&"phone_list".to_owned()));
    assert!(!commander
        .iter()
        .any(|n| n.starts_with("session_") || n.starts_with("feishu_")));
}
