//! FEISHU-01：飞书接入。内置飞书官方 lark-cli（larksuite/cli，MIT）：
//! 1. 扫一次码建“个人智能体”应用并记下主人（FEISHU-06，见 feishu_register.rs），凭据由 lark-cli 存进系统钥匙串；
//! 2. 可选：`auth login --recommend` 申请常用业务的用户权限（文档、表格、日历、任务等）。
//!
//! 每个 Lom 账号一个独立的 lark-cli 配置目录；凭据只在本机，不经过 Lom 服务器。
//! 同一时间只跑一个等待扫码的进程；界面通过 `feishu-connect` 事件得知每一步的结果。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub use crate::feishu_scope::FeishuState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// 当前在等授权的 lark-cli 进程；第二项是扫码接入的代次，取消 / 重新扫码 / 断开时加一，旧的轮询随之停止
#[derive(Default)]
pub struct ConnectionState(
    pub(crate) Mutex<Option<Child>>,
    pub(crate) AtomicU64,
    pub(crate) Mutex<Option<auth::AuthProgress>>,
    pub(crate) AtomicU64,
    pub(crate) Arc<crate::feishu_gateway::FeishuGateway>,
    pub(crate) Arc<crate::feishu_approvals::ApprovalGateway>,
    pub(crate) Mutex<()>,
    pub(crate) Mutex<()>,
);

#[path = "feishu_auth.rs"]
pub(crate) mod auth;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FeishuStatus {
    pub configured: bool,
    pub app_id: Option<String>,
    pub authorized: bool,
    /// 已能收发消息：应用已建、主人已知（一次扫码记下，或用户授权后得知）
    pub connected: bool,
    pub auth: Option<auth::AuthProgress>,
    pub generation: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FeishuPrompt {
    pub generation: u64,
    /// 扫码 / 打开的链接
    pub url: String,
    /// 链接对应的二维码（SVG）
    pub qr: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct StepResult {
    /// app：扫码建应用；auth：授权
    pub(crate) account: String,
    pub(crate) assistant_id: String,
    pub(crate) app_id: Option<String>,
    pub(crate) generation: u64,
    pub(crate) stage: &'static str,
    pub(crate) ok: bool,
    pub(crate) error: Option<String>,
}

/// 开发时可用 `LOM_LARK_CLI_BIN` 指定；打包后与主程序在同一目录（Tauri externalBin）
fn lark_binary() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("LOM_LARK_CLI_BIN") {
        return Ok(PathBuf::from(p));
    }
    let exe = std::env::current_exe().map_err(|e| format!("feishu.binary_not_found: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "feishu.binary_not_found: no parent directory".to_owned())?;
    let path = dir.join(if cfg!(windows) {
        "lark-cli.exe"
    } else {
        "lark-cli"
    });
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("feishu.binary_not_found: {}", path.display()))
    }
}

pub(crate) use crate::feishu_paths::config_dir;

pub(crate) fn command(dir: &Path, args: &[&str]) -> Result<Command, String> {
    let mut cmd = Command::new(lark_binary()?);
    cmd.args(args)
        .env("LARKSUITE_CLI_CONFIG_DIR", dir)
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：不弹黑色命令行窗口
    }
    Ok(cmd)
}

/// 只认飞书 / Lark 官方域名下的 https 链接，避免把别的地址做成二维码
pub fn official_url(raw: &str) -> Option<String> {
    let url = raw.trim().trim_end_matches(['.', '。', ')', '）']);
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?']).next()?;
    let ok = ["feishu.cn", "larksuite.com", "larkoffice.com"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")));
    (ok && !url.contains(char::is_whitespace)).then(|| url.to_owned())
}

/// `auth status --json`：未配置时是 `{"ok":false,...}`；已配置时直接给出 appId 与 identity（user / bot / none）
pub fn parse_status(stdout: &str) -> FeishuStatus {
    let value: serde_json::Value = serde_json::from_str(stdout).unwrap_or(serde_json::Value::Null);
    let app_id = value
        .get("appId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let authorized = value.get("identity").and_then(|v| v.as_str()) == Some("user");
    FeishuStatus {
        configured: app_id.is_some(),
        connected: app_id.is_some() && authorized,
        authorized,
        app_id,
        auth: None,
        generation: 0,
    }
}

/// `auth login --recommend --no-wait --json`：取出授权链接与 device_code（可能包在 data 里）
pub fn parse_login_start(stdout: &str) -> Option<(String, String)> {
    let value: serde_json::Value = serde_json::from_str(stdout).ok()?;
    let body = value.get("data").unwrap_or(&value);
    let url = official_url(body.get("verification_url")?.as_str()?)?;
    let code = body.get("device_code")?.as_str()?.to_owned();
    (!code.is_empty()).then_some((url, code))
}

pub(crate) fn prompt(url: String) -> Result<FeishuPrompt, String> {
    let qr = crate::pairing::qr_svg(&url).map_err(|e| format!("feishu.qr: {e}"))?;
    Ok(FeishuPrompt {
        url,
        qr,
        generation: 0,
    })
}

/// 换掉正在等待的旧进程（重新扫码、取消、断开都会先停掉它）
pub(crate) fn replace_child(state: &ConnectionState, next: Option<Child>) {
    let Ok(_operation) = state.7.lock() else {
        log::error!("feishu.state_failed");
        return;
    };
    state.1.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut progress) = state.2.lock() {
        *progress = None;
    }
    let old = match state.0.lock() {
        Ok(mut guard) => std::mem::replace(&mut *guard, next),
        Err(_) => {
            log::error!("feishu: state poisoned");
            return;
        }
    };
    if let Some(mut child) = old {
        if let Err(e) = child.kill() {
            log::warn!("feishu: failed to stop the previous lark-cli process: {e}");
        }
        if let Err(e) = child.wait() {
            log::warn!("feishu: failed to reap the previous lark-cli process: {e}");
        }
    }
}

#[tauri::command]
pub async fn feishu_status(
    app: AppHandle,
    account: String,
    assistant_id: Option<String>,
) -> Result<FeishuStatus, String> {
    let (dir, progress, generation) = if let Some(assistant) = assistant_id.as_deref() {
        let state = app.state::<Arc<FeishuState>>();
        let slot = state.scoped(&account, assistant)?;
        (
            crate::feishu_paths::scoped_config_dir(&app, &account, assistant)?,
            auth::progress(&slot),
            crate::feishu_scope::generation(&slot),
        )
    } else {
        (config_dir(&app, &account)?, None, 0)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let out = command(&dir, &["auth", "status", "--json"])?
            .output()
            .map_err(|e| format!("feishu.run_failed: {e}"))?;
        let mut status = parse_status(&String::from_utf8_lossy(&out.stdout));
        status.auth = progress;
        status.generation = generation;
        status.connected |= status.configured && crate::feishu_register::read_owner(&dir).is_some();
        Ok(status)
    })
    .await
    .map_err(|e| format!("feishu.join_failed: {e}"))?
}

/// 取消正在等待的扫码 / 授权
#[tauri::command]
pub fn feishu_cancel(
    state: tauri::State<'_, Arc<FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<(), String> {
    let slot = state.scoped(&account, &assistant_id)?;
    replace_child(&slot, None);
    Ok(())
}

/// 断开：清掉这个账号在 lark-cli 里的应用配置与令牌（钥匙串里的凭据一并清除）
#[tauri::command]
pub async fn feishu_disconnect(
    app: AppHandle,
    state: tauri::State<'_, Arc<FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<(), String> {
    let slot = state.scoped(&account, &assistant_id)?;
    replace_child(&slot, None);
    {
        let _lifecycle = slot.6.lock().map_err(|_| "feishu.state_failed")?;
        crate::feishu_scope::invalidate(&slot);
        crate::feishu_gateway::stop(&slot.4);
        crate::feishu_approvals::stop(&slot.5);
    }
    let dir = crate::feishu_paths::scoped_config_dir(&app, &account, &assistant_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::feishu_register::clear_owner(&dir);
        let out = command(&dir, &["config", "remove"])?
            .output()
            .map_err(|e| format!("feishu.run_failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "feishu.disconnect_failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("feishu.join_failed: {e}"))?
}

#[cfg(test)]
#[path = "feishu_tests.rs"]
mod tests;

#[tauri::command]
pub fn feishu_stop_account(state: tauri::State<'_, Arc<FeishuState>>, account: String) {
    for slot in state.account_slots(&account) {
        let Ok(_lifecycle) = slot.6.lock() else {
            log::error!("feishu.state_failed");
            continue;
        };
        replace_child(&slot, None);
        crate::feishu_scope::invalidate(&slot);
        crate::feishu_gateway::stop(&slot.4);
        crate::feishu_approvals::stop(&slot.5);
    }
}
#[tauri::command]
pub async fn feishu_migrate_legacy(
    app: AppHandle,
    account: String,
    assistant_id: String,
    app_id: String,
) -> Result<FeishuStatus, String> {
    crate::feishu_paths::validate_scope(&account, &assistant_id)?;
    let existing = feishu_status(app.clone(), account.clone(), None).await?;
    if existing.app_id.as_deref() != Some(&app_id) {
        return Err("feishu.binding_changed".into());
    }
    let state = app.state::<Arc<FeishuState>>();
    let target = crate::feishu_paths::scoped_config_dir(&app, &account, &assistant_id)?;
    let legacy = config_dir(&app, &account)?;
    if target != legacy && target.join("config.json").exists() {
        return Err("feishu.migration_conflict".into());
    }
    if crate::feishu_paths::legacy_owner(&legacy)?.is_some_and(|owner| owner != assistant_id) {
        return Err("feishu.binding_owned".into());
    }
    crate::feishu_paths::claim_app(&app, &account, &assistant_id, &app_id)?;
    state.claim(&account, &assistant_id, &app_id)?;
    crate::feishu_paths::claim_legacy(&config_dir(&app, &account)?, &assistant_id)?;
    feishu_status(app, account, Some(assistant_id)).await
}
