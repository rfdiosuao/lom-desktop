//! Local browser feedback. Never show success until Lom has validated its own session.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;
static CURRENT: Mutex<Option<Arc<AtomicU8>>> = Mutex::new(None);

pub fn begin() -> Result<(), String> {
    *CURRENT.lock().map_err(|_| "auth.feedback_locked")? = None;
    Ok(())
}

#[tauri::command]
pub fn login_complete(success: bool) -> Result<(), String> {
    let current = CURRENT.lock().map_err(|_| "auth.feedback_locked")?;
    if let Some(state) = current.as_ref() {
        state.store(if success { 1 } else { 2 }, Ordering::SeqCst);
    }
    Ok(())
}
fn page(nonce: &str, initial: &str) -> String {
    include_str!("../assets/login-callback.html")
        .replace(
            "__LOGO__",
            &STANDARD.encode(include_bytes!("../assets/login-logo.png")),
        )
        .replace("__NONCE__", nonce)
        .replace("__INITIAL__", initial)
}
fn reply(stream: &mut TcpStream, status: &str, kind: &str, body: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes()); // Closing the browser must not cancel the app login.
}
fn read(stream: &mut TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "auth.callback_failed")?;
    let mut bytes = [0; 8192];
    let n = stream
        .read(&mut bytes)
        .map_err(|_| "auth.callback_failed")?;
    Ok(String::from_utf8_lossy(&bytes[..n]).into_owned())
}
fn callback_query(request: &str, expected: &str) -> Option<String> {
    let target = request
        .lines()
        .next()?
        .strip_prefix("GET ")?
        .split_whitespace()
        .next()?;
    let query = target.strip_prefix("/callback?")?;
    if crate::login::query_param(query, "state").as_deref() != Some(expected) {
        return None;
    }
    Some(query.to_owned())
}
pub fn wait(
    listener: TcpListener,
    expected: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "auth.callback_failed")?;
    let deadline = Instant::now() + Duration::from_secs(300);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let request = read(&mut stream)?;
                let Some(query) = callback_query(&request, &expected) else {
                    reply(
                        &mut stream,
                        "400 Bad Request",
                        "text/html",
                        &page("", "error"),
                    );
                    continue;
                };
                let state = Arc::new(AtomicU8::new(0));
                *CURRENT.lock().map_err(|_| "auth.feedback_locked")? = Some(Arc::clone(&state));
                reply(
                    &mut stream,
                    "200 OK",
                    "text/html",
                    &page(&expected, "pending"),
                );
                std::thread::spawn(move || serve(listener, state, expected, app));
                return Ok(query);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(_) => return Err("auth.callback_failed".into()),
        }
    }
    Err("auth.timeout: 5 分钟内没有完成登录，请重试".into())
}
fn serve(listener: TcpListener, state: Arc<AtomicU8>, nonce: String, app: tauri::AppHandle) {
    let deadline = Instant::now() + Duration::from_secs(600);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let Ok(request) = read(&mut stream) else {
                    continue;
                }; // Ignore abandoned browser connections.
                let allowed = request.lines().any(|line| {
                    line.split_once(':').is_some_and(|(k, v)| {
                        k.eq_ignore_ascii_case("x-lom-callback") && v.trim() == nonce
                    })
                });
                let first = request.lines().next().unwrap_or("");
                if first.starts_with("GET /callback?") && callback_query(&request, &nonce).is_some()
                {
                    reply(&mut stream, "200 OK", "text/html", &page(&nonce, "pending"));
                } else if allowed && first == "GET /status HTTP/1.1" {
                    let phase = match state.load(Ordering::SeqCst) {
                        1 => "success",
                        2 => "error",
                        _ => "pending",
                    };
                    reply(
                        &mut stream,
                        "200 OK",
                        "application/json",
                        &format!("{{\"state\":\"{phase}\"}}"),
                    );
                } else if allowed && first == "POST /return HTTP/1.1" {
                    let result = app
                        .get_webview_window("main")
                        .ok_or_else(|| "窗口未打开".to_owned())
                        .and_then(|window| {
                            window
                                .unminimize()
                                .and_then(|_| window.show())
                                .and_then(|_| window.set_focus())
                                .map_err(|e| e.to_string())
                        });
                    reply(
                        &mut stream,
                        if result.is_ok() {
                            "200 OK"
                        } else {
                            "503 Service Unavailable"
                        },
                        "text/plain",
                        "",
                    );
                } else {
                    reply(&mut stream, "403 Forbidden", "text/plain", "");
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(e) => {
                log::warn!("auth.feedback_closed: {e}");
                return;
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn s04_01_callback_rejects_wrong_state_and_non_get() {
        assert!(callback_query("GET /callback?code=x&state=other HTTP/1.1", "expected").is_none());
        assert!(
            callback_query("POST /callback?code=x&state=expected HTTP/1.1", "expected").is_none()
        );
        assert!(
            callback_query("GET /callback?code=x&state=expected HTTP/1.1", "expected").is_some()
        );
    }
    #[test]
    fn s04_01_feedback_only_finishes_when_app_reports_result() {
        let state = Arc::new(AtomicU8::new(0));
        *CURRENT.lock().unwrap() = Some(Arc::clone(&state));
        assert_eq!(state.load(Ordering::SeqCst), 0);
        login_complete(true).unwrap();
        assert_eq!(state.load(Ordering::SeqCst), 1);
        login_complete(false).unwrap();
        assert_eq!(state.load(Ordering::SeqCst), 2);
    }
}
