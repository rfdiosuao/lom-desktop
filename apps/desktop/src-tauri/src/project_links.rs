use tauri_plugin_opener::OpenerExt;

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLink {
    Repository,
    Documentation,
}

#[tauri::command]
pub fn project_link_open(app: tauri::AppHandle, link: ProjectLink) -> Result<(), String> {
    let url = match link {
        ProjectLink::Repository => "https://github.com/rfdiosuao/lom-desktop",
        ProjectLink::Documentation => "https://github.com/rfdiosuao/lom-desktop/tree/main/docs",
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("project.browser_failed: {e}"))
}

/// D29: only canonical public GitHub repository links, no query, credentials or custom scheme.
#[tauri::command]
pub fn skill_repository_open(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let path = url
        .strip_prefix("https://github.com/")
        .ok_or("skill.invalid_repository")?;
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || *p == ".."
                || !p
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return Err("skill.invalid_repository".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "skill.browser_failed".into())
}

const MAX_WEB_LINK_LEN: usize = 2048;

/// D31: 只允许交给系统浏览器的 http(s) 地址；拒绝凭据、空白、控制字符和反斜杠。
fn valid_web_link(url: &str) -> bool {
    if url.len() < 8 || url.len() > MAX_WEB_LINK_LEN {
        return false;
    }
    if url
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return false;
    }
    let rest = if url
        .get(..7)
        .is_some_and(|s| s.eq_ignore_ascii_case("http://"))
    {
        url.get(7..)
    } else if url
        .get(..8)
        .is_some_and(|s| s.eq_ignore_ascii_case("https://"))
    {
        url.get(8..)
    } else {
        None
    };
    let Some(rest) = rest else {
        return false;
    };
    let Some(authority) = rest.split(['/', '?', '#']).next() else {
        return false;
    };
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    let host = authority.split(':').next().unwrap_or_default();
    !host.is_empty() && !host.starts_with('.')
}

/// 打开搜索结果等外部网页：前端只传 http(s)，这里再次校验后交给系统浏览器。
#[tauri::command]
pub fn web_link_open(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !valid_web_link(&url) {
        return Err("link.invalid_url".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "link.browser_failed".into())
}

#[cfg(test)]
mod tests {
    use super::valid_web_link;

    #[test]
    fn d31_accepts_http_and_https_links() {
        assert!(valid_web_link("https://example.com/a?b=1#c"));
        assert!(valid_web_link("http://example.com"));
        assert!(valid_web_link("HTTPS://Example.com/path"));
        assert!(valid_web_link("https://[::1]:8080/"));
    }

    #[test]
    fn d31_rejects_non_web_and_ambiguous_links() {
        assert!(!valid_web_link("file:///etc/passwd"));
        assert!(!valid_web_link("javascript:alert(1)"));
        assert!(!valid_web_link("data:text/html,hello"));
        assert!(!valid_web_link("https://user:pass@example.com/"));
        assert!(!valid_web_link("https://example.com\\@evil.com/"));
        assert!(!valid_web_link("https://example.com/\nnext"));
        assert!(!valid_web_link(&format!(
            "https://example.com/{}",
            "a".repeat(2048)
        )));
        assert!(!valid_web_link("https://"));
        assert!(!valid_web_link(""));
    }
}
