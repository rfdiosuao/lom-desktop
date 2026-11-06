use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, path::PathBuf};

// Deliberately no Debug: credentials must never enter diagnostics.
#[derive(Clone, Serialize, Deserialize)]
pub struct Grant {
    pub resource: String,
    pub client_id: String,
    pub token_endpoint: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64,
}

pub trait SecretStore: Send + Sync {
    fn load(&self, key: &str) -> Result<Option<Grant>>;
    fn save(&self, key: &str, grant: Option<&Grant>) -> Result<()>;
}
pub struct OsSecretStore;
impl SecretStore for OsSecretStore {
    fn load(&self, key: &str) -> Result<Option<Grant>> {
        if !supported() {
            return Err(Error("mcp.oauth.unsupported_os"));
        }
        let entry = keyring::Entry::new("top.heang.lom.mcp-oauth", key).map_err(|_| Error("mcp.oauth.secret_store"))?;
        match entry.get_password() {
            Ok(raw) => serde_json::from_str(&raw)
                .map(Some)
                .map_err(|_| Error("mcp.oauth.secret_store")),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(Error("mcp.oauth.secret_store")),
        }
    }
    fn save(&self, key: &str, grant: Option<&Grant>) -> Result<()> {
        if !supported() {
            return Err(Error("mcp.oauth.unsupported_os"));
        }
        let entry = keyring::Entry::new("top.heang.lom.mcp-oauth", key).map_err(|_| Error("mcp.oauth.secret_store"))?;
        if let Some(grant) = grant {
            let raw = serde_json::to_string(grant).map_err(|_| Error("mcp.oauth.secret_store"))?;
            entry.set_password(&raw).map_err(|_| Error("mcp.oauth.secret_store"))
        } else {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(Error("mcp.oauth.secret_store")),
            }
        }
    }
}
pub fn supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}
pub fn key(user: &str, resource: &str) -> String {
    let input = serde_json::to_vec(&(user, resource)).unwrap_or_default();
    format!("{:x}", Sha256::digest(input))
}
pub struct GrantLock(std::fs::File);
impl GrantLock {
    pub fn acquire(key: &str) -> Result<Self> {
        if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(Error("mcp.oauth.invalid_binding"));
        }
        let dir: PathBuf = std::env::temp_dir().join("lom-mcp-oauth-locks");
        std::fs::create_dir_all(&dir).map_err(|_| Error("mcp.oauth.lock_failed"))?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(dir.join(key))
            .map_err(|_| Error("mcp.oauth.lock_failed"))?;
        // Bounded, non-blocking retries; the async caller waits outside the lock syscall.
        fs2::FileExt::try_lock_exclusive(&file).map_err(|_| Error("mcp.oauth.busy"))?;
        Ok(Self(file))
    }
}
impl Drop for GrantLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}
