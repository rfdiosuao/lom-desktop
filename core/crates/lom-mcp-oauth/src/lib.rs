//! MCP-OAUTH-01: OS-secret-backed public-client PKCE for same-origin HTTP MCP.
//! No credentials enter renderer state, MCP configuration, logs or helper arguments.
mod discovery;
mod forward;
mod helper;
mod login;
pub mod store;

pub use forward::{WireState, run_stdio};
pub use helper::helper;
pub use login::PendingLogin;
use serde::Deserialize;
use std::{
    fmt,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use store::{Grant, GrantLock, SecretStore};

#[derive(Debug, Clone, Copy)]
pub struct Error(pub &'static str);
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
#[derive(Clone)]
pub struct OAuthClient {
    pub store: Arc<dyn SecretStore>,
    pub http: reqwest::Client,
    allow_loopback: bool,
}
impl OAuthClient {
    pub fn new(store: Arc<dyn SecretStore>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| Error("mcp.oauth.http_client"))?;
        Ok(Self {
            store,
            http,
            allow_loopback: false,
        })
    }
    pub fn desktop() -> Result<Self> {
        Self::new(Arc::new(store::OsSecretStore))
    }
    pub fn has_grant(&self, user: &str, resource: &str) -> Result<bool> {
        if !self.allow_loopback {
            discovery::resource(resource, false)?;
        }
        Ok(self.store.load(&store::key(user, resource))?.is_some())
    }
    pub async fn revoke_local(&self, user: &str, resource: &str) -> Result<()> {
        let _lock = lock(&store::key(user, resource)).await?;
        self.store.save(&store::key(user, resource), None)
    }
    pub async fn token(&self, user: &str, resource: &str) -> Result<String> {
        discovery::resource(resource, self.allow_loopback)?;
        let key = store::key(user, resource);
        let _lock = lock(&key).await?;
        let mut grant = self.store.load(&key)?.ok_or(Error("mcp.oauth.login_required"))?;
        if grant.resource != resource {
            return Err(Error("mcp.oauth.binding_mismatch"));
        }
        if grant.expires_at > now() + 60 {
            return Ok(grant.access_token);
        }
        discovery::same_origin(resource, &grant.token_endpoint, self.allow_loopback)?;
        let refresh = grant.refresh_token.clone().ok_or(Error("mcp.oauth.login_required"))?;
        let response = self
            .http
            .post(&grant.token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh.as_str()),
                ("client_id", &grant.client_id),
                ("resource", resource),
            ])
            .send()
            .await
            .map_err(|_| Error("mcp.oauth.refresh_network"))?;
        if !response.status().is_success() {
            return Err(Error("mcp.oauth.refresh_rejected"));
        }
        let token: Tokens = discovery::json(response)
            .await
            .map_err(|_| Error("mcp.oauth.refresh_response_invalid"))?;
        token.apply(&mut grant)?;
        self.store.save(&key, Some(&grant))?;
        Ok(grant.access_token)
    }
}
#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    token_type: String,
    expires_in: u64,
    refresh_token: Option<String>,
}
impl Tokens {
    fn apply(self, grant: &mut Grant) -> Result<()> {
        if self.access_token.is_empty()
            || self.access_token.len() > 16384
            || !self.token_type.eq_ignore_ascii_case("bearer")
            || self.expires_in < 1
        {
            return Err(Error("mcp.oauth.invalid_token_response"));
        }
        grant.access_token = self.access_token;
        grant.expires_at = now().saturating_add(self.expires_in.min(31_536_000));
        if let Some(refresh) = self.refresh_token {
            grant.refresh_token = Some(refresh);
        }
        Ok(())
    }
}
async fn lock(key: &str) -> Result<GrantLock> {
    let until = tokio::time::Instant::now() + std::time::Duration::from_secs(25);
    loop {
        match GrantLock::acquire(key) {
            Ok(lock) => return Ok(lock),
            Err(Error("mcp.oauth.busy")) if tokio::time::Instant::now() < until => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await
            }
            Err(e) => return Err(e),
        }
    }
}
#[derive(Clone, Default)]
pub struct CancelFlag(Arc<Mutex<bool>>);
impl CancelFlag {
    pub fn cancel(&self) {
        if let Ok(mut value) = self.0.lock() {
            *value = true;
        }
    }
    pub fn check(&self) -> Result<()> {
        if *self.0.lock().map_err(|_| Error("mcp.oauth.cancelled"))? {
            Err(Error("mcp.oauth.cancelled"))
        } else {
            Ok(())
        }
    }
    fn commit(&self, action: impl FnOnce() -> Result<()>) -> Result<()> {
        let value = self.0.lock().map_err(|_| Error("mcp.oauth.cancelled"))?;
        if *value {
            return Err(Error("mcp.oauth.cancelled"));
        }
        action()
    }
}

#[cfg(test)]
mod tests;
