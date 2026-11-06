use crate::{CancelFlag, Error, Grant, OAuthClient, Result, Tokens, discovery, lock, store};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub struct PendingLogin {
    pub authorization_url: String,
    listener: TcpListener,
    state: String,
    verifier: String,
    redirect: String,
    resource: String,
    client_id: String,
    token_endpoint: String,
}
fn random() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| Error("mcp.oauth.random"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
#[derive(Deserialize)]
struct Registration {
    client_id: String,
    client_secret: Option<String>,
    token_endpoint_auth_method: Option<String>,
}
impl OAuthClient {
    pub async fn prepare(&self, server: &str) -> Result<PendingLogin> {
        let metadata = self.discover(server).await?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| Error("mcp.oauth.callback_bind"))?;
        let addr = listener.local_addr().map_err(|_| Error("mcp.oauth.callback_bind"))?;
        let redirect = format!("http://127.0.0.1:{}/callback", addr.port());
        let reg:Registration=discovery::json(self.http.post(&metadata.registration_endpoint).json(&serde_json::json!({
            "client_name":"Lom", "redirect_uris":[redirect], "grant_types":["authorization_code","refresh_token"],
            "response_types":["code"],"token_endpoint_auth_method":"none"
        })).send().await.map_err(|_|Error("mcp.oauth.registration_failed"))?).await?;
        if reg.client_id.is_empty()
            || reg.client_id.len() > 1024
            || reg.client_secret.is_some()
            || reg.token_endpoint_auth_method.as_deref().is_some_and(|v| v != "none")
        {
            return Err(Error("mcp.oauth.public_client_required"));
        }
        let verifier = random()?;
        let state = random()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut auth = discovery::same_origin(server, &metadata.authorization_endpoint, self.allow_loopback)?;
        auth.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", reg.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("scope", "mcp"),
            ("resource", server),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ]);
        Ok(PendingLogin {
            authorization_url: auth.into(),
            listener,
            state,
            verifier,
            redirect,
            resource: server.into(),
            client_id: reg.client_id,
            token_endpoint: metadata.token_endpoint,
        })
    }
    pub async fn finish(&self, user: &str, pending: PendingLogin, flag: CancelFlag) -> Result<()> {
        let code = pending.callback(&flag).await?;
        flag.check()?;
        let response = self
            .http
            .post(&pending.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code.as_str()),
                ("client_id", pending.client_id.as_str()),
                ("redirect_uri", pending.redirect.as_str()),
                ("code_verifier", pending.verifier.as_str()),
                ("resource", pending.resource.as_str()),
            ])
            .send()
            .await
            .map_err(|_| Error("mcp.oauth.exchange_failed"))?;
        let tokens: Tokens = discovery::json(response).await?;
        flag.check()?;
        let key = store::key(user, &pending.resource);
        let _lock = lock(&key).await?;
        flag.check()?;
        let mut grant = Grant {
            resource: pending.resource,
            client_id: pending.client_id,
            token_endpoint: pending.token_endpoint,
            access_token: String::new(),
            refresh_token: None,
            expires_at: 0,
        };
        tokens.apply(&mut grant)?;
        flag.commit(|| self.store.save(&key, Some(&grant)))
    }
}
impl PendingLogin {
    async fn callback(&self, flag: &CancelFlag) -> Result<String> {
        let until = tokio::time::Instant::now() + std::time::Duration::from_secs(120);
        loop {
            flag.check()?;
            if tokio::time::Instant::now() >= until {
                return Err(Error("mcp.oauth.callback_timeout"));
            }
            let accepted = tokio::time::timeout(std::time::Duration::from_millis(100), self.listener.accept()).await;
            let Ok(Ok((mut stream, _))) = accepted else {
                continue;
            };
            let mut buf = vec![0u8; 8192];
            let n = match tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf)).await {
                Ok(Ok(n)) => n,
                _ => continue,
            };
            let valid = parse_callback(&buf[..n], &self.state);
            let (status, message) = match &valid {
                Ok(_) => ("200 OK", "Authorization received. Return to Lom to verify completion."),
                Err(Error("mcp.oauth.denied")) => ("200 OK", "Authorization cancelled. Return to Lom."),
                Err(_) => ("400 Bad Request", "Invalid authorization callback."),
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{message}",
                message.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            match valid {
                Ok(code) => return Ok(code),
                Err(Error("mcp.oauth.denied")) => return Err(Error("mcp.oauth.denied")),
                Err(_) => continue,
            }
        }
    }
}
fn parse_callback(bytes: &[u8], state: &str) -> Result<String> {
    let line = std::str::from_utf8(bytes)
        .map_err(|_| Error("mcp.oauth.invalid_callback"))?
        .lines()
        .next()
        .ok_or(Error("mcp.oauth.invalid_callback"))?;
    let mut parts = line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err(Error("mcp.oauth.invalid_callback"));
    }
    let target = parts.next().ok_or(Error("mcp.oauth.invalid_callback"))?;
    if !target.starts_with("/callback?") {
        return Err(Error("mcp.oauth.invalid_callback"));
    }
    let url =
        reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| Error("mcp.oauth.invalid_callback"))?;
    let pairs: Vec<_> = url.query_pairs().collect();
    let value = |key: &str| {
        let mut values = pairs.iter().filter(|(k, _)| k == key).map(|(_, v)| v.as_ref());
        match (values.next(), values.next()) {
            (Some(v), None) => Some(v),
            _ => None,
        }
    };
    if value("state") != Some(state) {
        return Err(Error("mcp.oauth.state_mismatch"));
    }
    if value("error").is_some() {
        return Err(Error("mcp.oauth.denied"));
    }
    value("code")
        .filter(|v| !v.is_empty() && v.len() <= 4096)
        .map(str::to_owned)
        .ok_or(Error("mcp.oauth.invalid_callback"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mcp_oauth_01_callback_rejects_wrong_state_duplicate_and_path() {
        for target in [
            "/callback?code=x&state=wrong",
            "/callback?code=x&state=s&state=s",
            "/other?code=x&state=s",
        ] {
            assert!(parse_callback(format!("GET {target} HTTP/1.1\r\n").as_bytes(), "s").is_err());
        }
        assert_eq!(
            parse_callback(b"GET /callback?code=x&state=s HTTP/1.1\r\n", "s").unwrap(),
            "x"
        );
        assert_eq!(
            parse_callback(b"GET /callback?error=access_denied&state=s HTTP/1.1\r\n", "s")
                .unwrap_err()
                .0,
            "mcp.oauth.denied"
        );
    }
}
