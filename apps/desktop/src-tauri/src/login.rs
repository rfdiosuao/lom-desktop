//! HEANG 统一账号登录（S04-01 §2.1）：OIDC 授权码 + PKCE（S256），环回重定向（RFC 8252）。
//! 外壳只负责拿到 id_token；校验和建会话由 lom-server 完成。Lom 会话令牌存系统钥匙串。

use std::net::TcpListener;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;

const KEYCHAIN_SERVICE: &str = "org.lom.community.desktop";
const KEYCHAIN_ACCOUNT: &str = "lom-session";

#[derive(Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn random_b64(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).map_err(|e| format!("auth.random_failed: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

pub(crate) fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = if bytes[i] == b'%' && i + 2 < bytes.len() {
            std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        } else {
            None
        };
        match (bytes[i], hex) {
            (_, Some(v)) => {
                out.push(v);
                i += 3;
            }
            (b'+', None) => {
                out.push(b' ');
                i += 1;
            }
            (b, None) => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(crate) fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        kv.split_once('=')
            .filter(|(k, _)| *k == key)
            .map(|(_, v)| dec(v))
    })
}

fn exchange(
    token_endpoint: &str,
    code: &str,
    redirect_uri: &str,
    client_id: &str,
    verifier: &str,
) -> Result<String, String> {
    let res = ureq::post(token_endpoint).send_form(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ]);
    let body: TokenResponse = match res {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("auth.token_failed: {e}"))?,
        Err(ureq::Error::Status(_, r)) => r
            .into_json()
            .map_err(|e| format!("auth.token_failed: {e}"))?,
        Err(e) => return Err(format!("auth.token_failed: {e}")),
    };
    match (body.id_token, body.error) {
        (Some(t), _) => Ok(t),
        (None, Some(e)) => Err(format!(
            "auth.token_failed: {e} {}",
            body.error_description.unwrap_or_default()
        )),
        (None, None) => Err("auth.token_failed: 登录平台没有返回 id_token".to_owned()),
    }
}

/// 发起登录：打开系统浏览器 → 等回调 → 用授权码换 id_token
#[tauri::command]
pub async fn heang_login(
    app: tauri::AppHandle,
    issuer: String,
    client_id: String,
    scope: String,
    method: Option<String>,
) -> Result<String, String> {
    crate::login_callback::begin()?;
    let disc: Discovery = ureq::get(&format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    ))
    .timeout(Duration::from_secs(20))
    .call()
    .map_err(|e| format!("auth.discovery_failed: {e}"))?
    .into_json()
    .map_err(|e| format!("auth.discovery_failed: {e}"))?;
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("auth.callback_failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("auth.callback_failed: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let verifier = random_b64(48)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_b64(24)?;
    let url = format!(
        "{}?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        disc.authorization_endpoint, enc(&client_id), enc(&redirect_uri), enc(&scope), enc(&state), enc(&challenge)
    );
    let url = crate::login_target::target(
        &url,
        &issuer,
        &client_id,
        method.as_deref().unwrap_or("login"),
    )?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("auth.browser_failed: {e}"))?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let query = crate::login_callback::wait(listener, state.clone(), app)?;
        if let Some(err) = query_param(&query, "error") {
            return Err(format!("auth.denied: {err}"));
        }
        if query_param(&query, "state").as_deref() != Some(state.as_str()) {
            return Err("auth.state_mismatch: 回调校验失败，请重新登录".to_owned());
        }
        let code = query_param(&query, "code").ok_or("auth.no_code: 回调里没有授权码")?;
        exchange(
            &disc.token_endpoint,
            &code,
            &redirect_uri,
            &client_id,
            &verifier,
        )
    })
    .await
    .map_err(|e| format!("auth.join_failed: {e}"))?;
    if result.is_err() {
        crate::login_callback::login_complete(false)?;
    }
    result
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("auth.keychain_failed: {e}"))
}

#[tauri::command]
pub fn session_get() -> Result<Option<String>, String> {
    match keychain()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("auth.keychain_failed: {e}")),
    }
}

#[tauri::command]
pub fn session_set(token: String) -> Result<(), String> {
    keychain()?
        .set_password(&token)
        .map_err(|e| format!("auth.keychain_failed: {e}"))
}

#[tauri::command]
pub fn session_clear() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("auth.keychain_failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decoding_and_query_parsing() {
        assert_eq!(dec("a%20b+c"), "a b c");
        assert_eq!(
            query_param("code=x%2By&state=s1", "code").as_deref(),
            Some("x+y")
        );
        assert_eq!(
            query_param("code=x&state=s1", "state").as_deref(),
            Some("s1")
        );
        assert_eq!(query_param("code=x", "error"), None);
    }

    #[test]
    fn percent_encoding_keeps_unreserved() {
        assert_eq!(
            enc("http://127.0.0.1:1/callback"),
            "http%3A%2F%2F127.0.0.1%3A1%2Fcallback"
        );
        assert_eq!(enc("openid profile"), "openid%20profile");
    }
}
