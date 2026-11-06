use crate::{Error, OAuthClient, Result};
use reqwest::Url;
use serde::{Deserialize, de::DeserializeOwned};

pub fn resource(value: &str, allow_loopback: bool) -> Result<Url> {
    let u = Url::parse(value).map_err(|_| Error("mcp.oauth.invalid_url"))?;
    let local = allow_loopback && u.scheme() == "http" && u.host_str() == Some("127.0.0.1");
    if !(u.scheme() == "https" || local)
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(Error("mcp.oauth.invalid_url"));
    }
    Ok(u)
}
pub fn same_origin(base: &str, endpoint: &str, allow_loopback: bool) -> Result<Url> {
    let a = resource(base, allow_loopback)?;
    let b = resource(endpoint, allow_loopback)?;
    if a.origin() != b.origin() {
        return Err(Error("mcp.oauth.cross_origin_unsupported"));
    }
    Ok(b)
}
pub async fn json<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T> {
    if !response.status().is_success() {
        return Err(Error("mcp.oauth.provider_rejected"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error("mcp.oauth.network"))? {
        if bytes.len() + chunk.len() > 65536 {
            return Err(Error("mcp.oauth.response_too_large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| Error("mcp.oauth.invalid_response"))
}
#[derive(Deserialize)]
struct ProtectedResource {
    resource: String,
    authorization_servers: Vec<String>,
}
#[derive(Deserialize)]
pub struct Metadata {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
    pub code_challenge_methods_supported: Vec<String>,
}
impl OAuthClient {
    pub(crate) async fn discover(&self, server: &str) -> Result<Metadata> {
        let url = resource(server, self.allow_loopback)?;
        let root = url.origin().ascii_serialization();
        let path = format!(
            "{root}/.well-known/oauth-protected-resource{}",
            url.path().trim_end_matches('/')
        );
        let protected: ProtectedResource = json(
            self.http
                .get(path)
                .send()
                .await
                .map_err(|_| Error("mcp.oauth.discovery_failed"))?,
        )
        .await?;
        if protected.resource.trim_end_matches('/') != server.trim_end_matches('/')
            || protected.authorization_servers.len() != 1
        {
            return Err(Error("mcp.oauth.resource_mismatch"));
        }
        let issuer = same_origin(server, &protected.authorization_servers[0], self.allow_loopback)?;
        if issuer.path() != "/" {
            return Err(Error("mcp.oauth.issuer_path_unsupported"));
        }
        let metadata: Metadata = json(
            self.http
                .get(format!("{root}/.well-known/oauth-authorization-server"))
                .send()
                .await
                .map_err(|_| Error("mcp.oauth.discovery_failed"))?,
        )
        .await?;
        for endpoint in [
            &metadata.authorization_endpoint,
            &metadata.token_endpoint,
            &metadata.registration_endpoint,
        ] {
            same_origin(server, endpoint, self.allow_loopback)?;
        }
        if !metadata.code_challenge_methods_supported.iter().any(|v| v == "S256") {
            return Err(Error("mcp.oauth.pkce_required"));
        }
        Ok(metadata)
    }
}
