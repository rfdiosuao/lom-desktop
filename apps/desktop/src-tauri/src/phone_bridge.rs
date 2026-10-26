//! Loopback MCP adapter. Each capability is scoped to one desktop conversation.
use crate::remote_wire::{CommanderCall, CommanderConfig};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Bridge {
    port: Mutex<Option<u16>>,
    tokens: Mutex<HashMap<String, String>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
}
fn nonce() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "phone.entropy_failed")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
#[tauri::command]
pub fn phone_bridge_config(
    scope: String,
    state: tauri::State<'_, Arc<Bridge>>,
) -> Result<CommanderConfig, String> {
    if scope.len() > 80 || scope.len() < 16 {
        return Err("phone.invalid_scope".into());
    }
    let port = state
        .port
        .lock()
        .map_err(|_| "phone.bridge_state")?
        .ok_or("phone.bridge_unavailable")?;
    let mut tokens = state.tokens.lock().map_err(|_| "phone.bridge_state")?;
    let token = if let Some(t) = tokens.get(&scope) {
        t.clone()
    } else {
        let t = nonce()?;
        tokens.insert(scope.clone(), t.clone());
        t
    };
    Ok(CommanderConfig {
        scope,
        url: format!("http://127.0.0.1:{port}/mcp"),
        token,
    })
}
#[tauri::command]
pub fn phone_bridge_reply(
    id: String,
    result: Value,
    state: tauri::State<'_, Arc<Bridge>>,
) -> Result<(), String> {
    if let Some(tx) = state
        .pending
        .lock()
        .map_err(|_| "phone.bridge_state")?
        .remove(&id)
    {
        let _ = tx.send(result);
    }
    Ok(()) // A timed-out request is deliberately never replayed.
}
/// 个人助理的会话用 `pa-` 开头的 scope，只拿到调度会话的工具（PA04）；其他会话拿到手机与本机 Agent 工具
fn tools(scope: &str) -> Value {
    let list = if scope.starts_with("pa-") {
        include_str!("session_tools.json")
    } else {
        include_str!("phone_tools.json")
    };
    let mut result: Value = serde_json::from_str(list).unwrap_or_else(|_| json!([]));
    if scope.starts_with("pa-") {
        if let (Some(rows), Ok(Value::Array(extra))) = (
            result.as_array_mut(),
            serde_json::from_str::<Value>(include_str!("feishu_tools.json")),
        ) {
            rows.extend(extra);
        }
    }
    result
}
pub fn start(app: tauri::AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "phone.bridge_bind")?;
    let state = Arc::clone(app.state::<Arc<Bridge>>().inner());
    *state.port.lock().map_err(|_| "phone.bridge_state")? = Some(
        listener
            .local_addr()
            .map_err(|_| "phone.bridge_bind")?
            .port(),
    );
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let a = app.clone();
                    let s = Arc::clone(&state);
                    std::thread::spawn(move || {
                        if let Err(e) = serve(stream, s, |event| {
                            a.emit("phone-tool", event).map_err(|_| ())
                        }) {
                            log::debug!("phone bridge: {e}");
                        }
                    });
                }
                Err(_) => log::warn!("phone bridge accept failed"),
            }
        }
    });
    Ok(())
}
fn response(stream: &mut TcpStream, code: u16, body: Value) -> Result<(), String> {
    let body = body.to_string();
    write!(stream,"HTTP/1.1 {code} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",if code==200 {"OK"}else{"Status"},body.len()).map_err(|_|"phone.bridge_write".into())
}
fn serve(
    mut stream: TcpStream,
    state: Arc<Bridge>,
    emit: impl Fn(CommanderCall) -> Result<(), ()>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "phone.bridge_timeout")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "phone.bridge_timeout")?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|_| "phone.bridge_read")?);
    let mut first = String::new();
    reader
        .by_ref()
        .take(16385)
        .read_line(&mut first)
        .map_err(|_| "phone.bridge_read")?;
    if !first.starts_with("POST /mcp HTTP/1.") {
        return response(&mut stream, 405, json!({"error":"method"}));
    }
    if first.len() > 16384 {
        return Err("phone.bridge_headers".into());
    }
    let mut length = 0usize;
    let mut auth = String::new();
    let mut total = first.len();
    loop {
        let mut line = String::new();
        let n = reader
            .by_ref()
            .take((16385 - total) as u64)
            .read_line(&mut line)
            .map_err(|_| "phone.bridge_read")?;
        total += n;
        if total > 16384 || n == 0 {
            return Err("phone.bridge_headers".into());
        }
        if line == "\r\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            match k.to_lowercase().as_str() {
                "content-length" => length = v.trim().parse().map_err(|_| "phone.bridge_length")?,
                "authorization" => auth = v.trim().strip_prefix("Bearer ").unwrap_or("").to_owned(),
                "origin" => return response(&mut stream, 403, json!({"error":"origin"})),
                _ => {}
            }
        }
    }
    dispatch(stream, reader, state, emit, auth, length)
}
fn dispatch(
    mut stream: TcpStream,
    mut reader: BufReader<TcpStream>,
    state: Arc<Bridge>,
    emit: impl Fn(CommanderCall) -> Result<(), ()>,
    auth: String,
    length: usize,
) -> Result<(), String> {
    let scope = state
        .tokens
        .lock()
        .map_err(|_| "phone.bridge_state")?
        .iter()
        .find(|(_, v)| **v == auth)
        .map(|(k, _)| k.clone());
    let Some(scope) = scope else {
        return response(&mut stream, 401, json!({"error":"unauthorized"}));
    };
    if length > 262144 || length == 0 {
        return response(&mut stream, 413, json!({"error":"size"}));
    }
    let mut bytes = vec![0; length];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| "phone.bridge_body")?;
    let req: Value = serde_json::from_slice(&bytes).map_err(|_| "phone.bridge_json")?;
    if req.get("id").is_none() {
        return response(&mut stream, 202, json!({}));
    }
    respond_rpc(&mut stream, &state, &emit, &scope, &req)
}
fn respond_rpc(
    stream: &mut TcpStream,
    state: &Bridge,
    emit: &impl Fn(CommanderCall) -> Result<(), ()>,
    scope: &str,
    req: &Value,
) -> Result<(), String> {
    let method = req["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => {
            json!({"protocolVersion":req["params"]["protocolVersion"].as_str().unwrap_or("2024-11-05"),"capabilities":{"tools":{}},"serverInfo":{"name":"lom-phone","version":"1.0"}})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools":tools(scope)}),
        "tools/call" => call(state, emit, scope, &req["params"]),
        _ => {
            return response(
                stream,
                200,
                json!({"jsonrpc":"2.0","id":req["id"],"error":{"code":-32601,"message":"Unknown method"}}),
            )
        }
    };
    response(
        stream,
        200,
        json!({"jsonrpc":"2.0","id":req["id"],"result":result}),
    )
}
fn failure(code: &str) -> Value {
    json!({"isError":true,"content":[{"type":"text","text":code}]})
}
fn call(
    state: &Bridge,
    emit: &impl Fn(CommanderCall) -> Result<(), ()>,
    scope: &str,
    p: &Value,
) -> Value {
    let name = p["name"].as_str().unwrap_or("");
    if !tools(scope)
        .as_array()
        .is_some_and(|list| list.iter().any(|t| t["name"] == name))
    {
        return failure("phone.unknown_tool");
    }
    let Ok(id) = nonce() else {
        return failure("phone.entropy_failed");
    };
    let (tx, rx) = mpsc::channel();
    if let Ok(mut pending) = state.pending.lock() {
        if pending.len() >= 16 {
            return failure("phone.bridge_busy");
        }
        pending.insert(id.clone(), tx);
    } else {
        return failure("phone.bridge_state");
    }
    let event = CommanderCall {
        id: id.clone(),
        scope: scope.to_owned(),
        name: name.to_owned(),
        arguments: p.get("arguments").cloned().unwrap_or(json!({})).to_string(),
    };
    let result = if emit(event).is_err() {
        failure("phone.bridge_unavailable")
    } else {
        rx.recv_timeout(Duration::from_secs(45))
            .unwrap_or_else(|_| failure("phone.result_unknown_do_not_retry_actions"))
    };
    if let Ok(mut pending) = state.pending.lock() {
        pending.remove(&id);
    }
    result
}

#[cfg(test)]
#[path = "phone_bridge_tests.rs"]
mod tests;
