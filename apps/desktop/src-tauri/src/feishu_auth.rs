//! FEISHU-08: native authorization lifetime and verified completion.
use super::*;
#[path = "feishu_auth_start.rs"]
mod start;
use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AuthProgress {
    pub account: String,
    pub assistant_id: String,
    pub app_id: Option<String>,
    pub generation: u64,
    pub pending: bool,
    pub prompt: Option<FeishuPrompt>,
    pub error: Option<String>,
    pub warning: Option<String>,
}

#[derive(Serialize, Clone)]
struct AuthResult {
    stage: &'static str,
    account: String,
    assistant_id: String,
    app_id: String,
    generation: u64,
    ok: bool,
    error: Option<String>,
    warning: Option<String>,
}

pub(super) fn progress(state: &ConnectionState) -> Option<AuthProgress> {
    state.2.lock().ok()?.clone()
}

/// Only application and owner identity verified by `auth status` may establish success.
/// 已记下主人时授权人必须是主人；FEISHU-06 之前两次扫码接入的没有主人记录，由这次授权确定主人。
fn verified(stdout: &str, app_id: &str, owner: Option<&str>) -> Option<String> {
    let status = parse_status(stdout);
    let actual = crate::feishu_gateway::owner_open_id(stdout)?;
    (status.app_id.as_deref() == Some(app_id)
        && status.authorized
        && owner.is_none_or(|o| o == actual))
    .then_some(actual)
}

/// CLI output is untrusted and may contain tokens, device codes or URLs. Never emit raw JSON.
fn safe_detail(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    if line.trim().is_empty()
        || line.contains(['{', '}'])
        || [
            "token",
            "device",
            "code=",
            "secret",
            "authorization",
            "bearer",
        ]
        .iter()
        .any(|key| lower.contains(key))
    {
        return None;
    }
    let line = line.trim().trim_start_matches('[');
    let line = line.split_once("] ").map_or(line, |(_, tail)| tail);
    Some(
        line.split_whitespace()
            .map(|word| {
                if word.contains("://") {
                    "[链接已隐藏]"
                } else {
                    word
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(400)
            .collect(),
    )
}

fn completion(
    stdout: Result<String, String>,
    app_id: &str,
    owner: Option<&str>,
    lines: &[String],
) -> Result<String, String> {
    let stdout = stdout.map_err(|_| "feishu.auth_status_failed: 无法确认授权结果".to_owned())?;
    if let Some(actual) = verified(&stdout, app_id, owner) {
        return Ok(actual);
    }
    let expired = lines.iter().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.contains("expired") || lower.contains("timeout")
    });
    if expired {
        return Err("feishu.auth_expired: 授权已过期，请重试".into());
    }
    let detail = lines.iter().rev().find_map(|line| safe_detail(line));
    Err(format!(
        "feishu.auth_not_saved: 飞书已同意但本机未保存，请重试{}",
        detail.map(|s| format!("（{s}）")).unwrap_or_default()
    ))
}

fn status_json(dir: &Path) -> Result<String, String> {
    let out = command(dir, &["auth", "status", "--json"])?
        .output()
        .map_err(|_| "feishu.auth_status_failed".to_owned())?;
    if !out.status.success() || serde_json::from_slice::<serde_json::Value>(&out.stdout).is_err() {
        return Err("feishu.auth_status_failed".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn pump(
    stream: impl Read + Send + 'static,
    lines: mpsc::SyncSender<String>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        // Bounded channel and lines prevent verbose CLI output exhausting memory.
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            if lines.send(line.chars().take(4096).collect()).is_err() {
                break;
            }
        }
    })
}

struct AuthFlow {
    account: String,
    assistant_id: String,
    dir: PathBuf,
    app_id: String,
    owner: Option<String>,
    pid: u32,
    generation: u64,
}
fn collect_lines(
    state: &ConnectionState,
    flow: &AuthFlow,
    collect: mpsc::Receiver<String>,
) -> Option<Vec<String>> {
    let AuthFlow {
        pid, generation, ..
    } = flow;
    let mut tail = std::collections::VecDeque::new();
    loop {
        for line in collect.try_iter() {
            if tail.len() == 24 {
                tail.pop_front();
            }
            tail.push_back(line);
        }
        if state.1.load(Ordering::SeqCst) != *generation {
            return None;
        }
        let Ok(mut guard) = state.0.lock() else {
            return None;
        };
        match guard.as_mut() {
            Some(child) if child.id() == *pid => match child.try_wait() {
                Ok(Some(_)) | Err(_) => {
                    *guard = None;
                    break;
                }
                Ok(None) => {}
            },
            _ => return None,
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));
    }
    // Reader channels close after both pipes reach EOF; drain their final messages.
    for line in collect {
        if tail.len() == 24 {
            tail.pop_front();
        }
        tail.push_back(line);
    }
    let lines: Vec<String> = tail.into_iter().collect();
    Some(lines)
}
fn finish_flow(app: AppHandle, flow: AuthFlow, lines: Vec<String>) {
    let AuthFlow {
        account,
        assistant_id,
        dir,
        app_id,
        owner,
        generation,
        ..
    } = flow;
    let registry = app.state::<Arc<FeishuState>>();
    let Ok(state) = registry.scoped(&account, &assistant_id) else {
        return;
    };
    let result =
        completion(status_json(&dir), &app_id, owner.as_deref(), &lines).and_then(|actual| {
            let _operation = state.7.lock().map_err(|_| "feishu.state_failed")?;
            if state.1.load(Ordering::SeqCst) != generation {
                return Err("feishu.auth_cancelled".into());
            }
            if owner.is_none() {
                crate::feishu_register::write_owner(&dir, &actual)?;
            }
            Ok(())
        });
    let warning = lines
        .iter()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("restrict") || lower.contains("denied") || line.contains("管理员")
        })
        .filter_map(|line| safe_detail(line))
        .collect::<Vec<_>>()
        .join("；");
    if state.1.load(Ordering::SeqCst) != generation {
        return;
    }
    let warning = (!warning.is_empty()).then_some(warning);
    let error = result.err();
    if let Ok(mut p) = state.2.lock() {
        *p = Some(AuthProgress {
            account: account.clone(),
            assistant_id: assistant_id.clone(),
            app_id: Some(app_id.clone()),
            generation: crate::feishu_scope::generation(&state),
            pending: false,
            prompt: None,
            error: error.clone(),
            warning: warning.clone(),
        });
    }
    if error.is_none() && crate::feishu_gateway::send_owner_auth_message(&dir, None).is_err() {
        log::warn!("feishu.auth_notice_failed");
    }
    if state.1.load(Ordering::SeqCst) != generation {
        return;
    }
    if app
        .emit(
            "feishu-connect",
            AuthResult {
                stage: "auth",
                account,
                assistant_id,
                app_id,
                generation: crate::feishu_scope::generation(&state),
                ok: error.is_none(),
                error,
                warning,
            },
        )
        .is_err()
    {
        log::warn!("feishu.auth_notify_failed");
    }
}
fn watch(app: AppHandle, flow: AuthFlow, collect: mpsc::Receiver<String>) {
    std::thread::spawn(move || {
        let registry = app.state::<Arc<FeishuState>>();
        let Ok(state) = registry.scoped(&flow.account, &flow.assistant_id) else {
            return;
        };
        if let Some(lines) = collect_lines(&state, &flow, collect) {
            finish_flow(app.clone(), flow, lines);
        }
    });
}

#[tauri::command]
pub async fn feishu_authorize_begin(
    app: AppHandle,
    state: tauri::State<'_, Arc<FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<FeishuPrompt, String> {
    let state = state.scoped(&account, &assistant_id)?;
    if let Some(existing) = progress(&state).filter(|p| p.pending) {
        return existing
            .prompt
            .ok_or_else(|| "feishu.auth_starting: 正在准备授权".into());
    }
    replace_child(&state, None);
    let generation = state.1.load(Ordering::SeqCst);
    if let Ok(mut p) = state.2.lock() {
        *p = Some(AuthProgress {
            account: account.clone(),
            assistant_id: assistant_id.clone(),
            app_id: None,
            generation: crate::feishu_scope::generation(&state),
            pending: true,
            prompt: None,
            error: None,
            warning: None,
        });
    }
    let dir = crate::feishu_paths::scoped_config_dir(&app, &account, &assistant_id)?;
    let start_dir = dir.clone();
    let started = tauri::async_runtime::spawn_blocking(move || start::prepare(&start_dir))
        .await
        .map_err(|_| "feishu.authorize_failed".to_owned())?;
    let (app_id, owner, url, code) = match started {
        Ok(value) => value,
        Err(error) => {
            if state.1.load(Ordering::SeqCst) == generation {
                replace_child(&state, None);
            }
            return Err(error);
        }
    };
    if state.1.load(Ordering::SeqCst) != generation {
        return Err("feishu.auth_cancelled".into());
    }
    let (mut child, rx) = start::poll(&dir, &code)?;
    let pid = child.id();
    {
        let _operation = state.7.lock().map_err(|_| "feishu.state_failed")?;
        if state.1.load(Ordering::SeqCst) != generation {
            let _ = child.kill();
            let _ = child.wait();
            return Err("feishu.auth_cancelled".into());
        }
        *state.0.lock().map_err(|_| "feishu.state_failed")? = Some(child);
    }
    let mut prompt = prompt(url)?;
    prompt.generation = crate::feishu_scope::generation(&state);
    let card_dir = dir.clone();
    let card_url = prompt.url.clone();
    let warning = tauri::async_runtime::spawn_blocking(move || {
        crate::feishu_gateway::send_owner_auth_message(&card_dir, Some(&card_url))
    })
    .await
    .ok()
    .and_then(Result::err)
    .map(|_| "feishu.auth_card_failed: 飞书消息发送失败，请扫码".to_owned());
    if let Ok(mut p) = state.2.lock() {
        if state.1.load(Ordering::SeqCst) == generation {
            *p = Some(AuthProgress {
                account: account.clone(),
                assistant_id: assistant_id.clone(),
                app_id: Some(app_id.clone()),
                generation: crate::feishu_scope::generation(&state),
                pending: true,
                prompt: Some(prompt.clone()),
                error: None,
                warning,
            });
        }
    }
    watch(
        app,
        AuthFlow {
            account,
            assistant_id,
            dir,
            app_id,
            owner,
            pid,
            generation,
        },
        rx,
    );
    Ok(prompt)
}

#[tauri::command]
pub async fn feishu_auth_revoke(
    app: AppHandle,
    state: tauri::State<'_, Arc<FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<(), String> {
    let state = state.scoped(&account, &assistant_id)?;
    replace_child(&state, None);
    let dir = crate::feishu_paths::scoped_config_dir(&app, &account, &assistant_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = command(&dir, &["auth", "logout"])?
            .output()
            .map_err(|_| "feishu.revoke_failed".to_owned())?;
        if !out.status.success() {
            return Err("feishu.revoke_failed".into());
        }
        if parse_status(&status_json(&dir)?).authorized {
            return Err("feishu.revoke_not_saved".into());
        }
        Ok(())
    })
    .await
    .map_err(|_| "feishu.revoke_failed".to_owned())?
}

#[cfg(test)]
#[path = "feishu_auth_tests.rs"]
mod tests;
