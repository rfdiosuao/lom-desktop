use crate::{Error, OAuthClient, Result};
use std::{collections::HashMap, path::PathBuf};

pub struct Helper {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}
/// Keep the public URL in the database. Only the per-session runtime transport
/// becomes an stdio helper; credentials stay in the OS secret store.
pub fn helper(user: &str, url: &str, headers: &HashMap<String, String>) -> Result<Option<Helper>> {
    if !crate::store::supported()
        || std::env::var_os("LOM_LAUNCH_TOKEN").is_none()
        || crate::discovery::resource(url, false).is_err()
        || !headers.is_empty()
    {
        return Ok(None);
    }
    let client = OAuthClient::desktop()?;
    if !client.has_grant(user, url)? {
        return Ok(None);
    }
    Ok(Some(Helper {
        command: std::env::current_exe().map_err(|_| Error("mcp.oauth.helper_missing"))?,
        args: vec![
            "mcp-oauth-stdio".into(),
            "--user-id".into(),
            user.into(),
            "--server-url".into(),
            url.into(),
        ],
        env: HashMap::new(),
    }))
}
