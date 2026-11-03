//! FEISHU-02：飞书消息网关（本机）。用内置 lark-cli 的长连接收机器人私聊消息，转给界面送进个人助理会话；
//! 回复（文本 / 流式卡片）也经 lark-cli 以机器人身份调用飞书开放接口。
//!
//! 只接收“扫码授权的那个人”私聊机器人的消息：同一租户里别人私聊这个机器人、或在群里 @ 它，都不会驱动助理。
//! 凭据始终在本机钥匙串里；消息正文不写日志。

use std::io::Write;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, Mutex};

#[path = "feishu_listener.rs"]
mod listener;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::feishu::command;

/// 正在运行的长连接进程；stdin 一直开着，Lom 退出时管道关闭，lark-cli 跟着退出
#[derive(Default)]
pub struct FeishuGateway(Mutex<Option<(Child, ChildStdin)>>);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FeishuInbound {
    pub account: String,
    pub assistant_id: String,
    pub app_id: String,
    pub generation: u64,
    pub message_id: String,
    pub chat_id: String,
    pub text: String,
}

impl FeishuInbound {
    fn scoped(mut self, account: &str, assistant: &str, app: &str, generation: u64) -> Self {
        self.account = account.into();
        self.assistant_id = assistant.into();
        self.app_id = app.into();
        self.generation = generation;
        self
    }
}

#[derive(Serialize, Clone)]
struct ListenEnded {
    account: String,
    assistant_id: String,
    app_id: String,
    generation: u64,
    error: Option<String>,
}

/// `auth status --json` 里授权用户的 open_id（identities.user.openId）
pub fn owner_open_id(status: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(status).ok()?;
    let id = value.pointer("/identities/user/openId")?.as_str()?;
    (id.starts_with("ou_") && value.get("identity")?.as_str()? == "user").then(|| id.to_owned())
}

/// `event consume im.message.receive_v1` 的一行：只留主人私聊机器人的消息
pub fn inbound(line: &str, owner: &str) -> Option<FeishuInbound> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let field = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default();
    if field("chat_type") != "p2p" || field("sender_id") != owner || field("sender_type") == "app" {
        return None;
    }
    let message_id = field("message_id");
    let text = field("content").trim();
    if !message_id.starts_with("om_") || text.is_empty() {
        return None;
    }
    Some(FeishuInbound {
        account: String::new(),
        assistant_id: String::new(),
        app_id: String::new(),
        generation: 0,
        message_id: message_id.to_owned(),
        chat_id: field("chat_id").to_owned(),
        text: text.to_owned(),
    })
}

/// 回复只走这几类接口：卡片实体与流式更新、对某条消息回复、给某条消息加 / 撤“正在输入”表情（FEISHU-05）
pub fn allowed_api(method: &str, path: &str) -> bool {
    let clean = path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-'));
    if !clean || path.contains("//") || !matches!(method, "POST" | "PUT" | "PATCH" | "DELETE") {
        return false;
    }
    let message = path.strip_prefix("/open-apis/im/v1/messages/om_");
    let parts: Vec<&str> = message
        .map(|rest| rest.split('/').collect())
        .unwrap_or_default();
    // om_x/reactions/<reaction_id>
    if method == "DELETE" {
        return parts.len() == 3 && parts[1] == "reactions" && !parts[2].is_empty();
    }
    let reply = parts.len() == 2 && parts[1] == "reply";
    let react = method == "POST" && parts.len() == 2 && parts[1] == "reactions";
    reply
        || react
        || path == "/open-apis/cardkit/v1/cards"
        || path.starts_with("/open-apis/cardkit/v1/cards/")
}

/// A live child is evidence of a running listener, never proof of network/message health.
pub(crate) fn running(state: &FeishuGateway) -> bool {
    match state.0.lock() {
        Ok(mut guard) => guard
            .as_mut()
            .is_some_and(|(child, _)| matches!(child.try_wait(), Ok(None))),
        Err(_) => {
            log::error!("feishu.state_failed");
            false
        }
    }
}

pub(crate) fn stop(state: &FeishuGateway) {
    let old = match state.0.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => {
            log::error!("feishu gateway: state poisoned");
            return;
        }
    };
    if let Some((mut child, stdin)) = old {
        // 先关 stdin 让 lark-cli 自己退出（会注销飞书端的订阅）；强杀会跳过清理，最多等 3 秒
        drop(stdin);
        for _ in 0..30 {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if let Err(e) = child.kill() {
            log::warn!("feishu gateway: failed to stop lark-cli: {e}");
        }
        if let Err(e) = child.wait() {
            log::warn!("feishu gateway: failed to reap lark-cli: {e}");
        }
    }
}

/// 开始收消息：每条主人私聊通过 `feishu-message` 发给界面；连接断开时发 `feishu-listen-ended`
#[tauri::command]
pub async fn feishu_listen_start(
    app: AppHandle,
    registry: tauri::State<'_, Arc<crate::feishu::FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<u64, String> {
    let slot = registry.scoped(&account, &assistant_id)?;
    let requested_generation = crate::feishu_scope::generation(&slot);
    let state = slot.4.clone();
    let dir = crate::feishu_paths::scoped_config_dir(&app, &account, &assistant_id)?;
    let status_dir = dir.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        command(&status_dir, &["auth", "status", "--json"])?
            .output()
            .map_err(|e| format!("feishu.run_failed: {e}"))
    })
    .await
    .map_err(|e| format!("feishu.join_failed: {e}"))??;
    let _lifecycle = slot.6.lock().map_err(|_| "feishu.state_failed")?;
    crate::feishu_scope::check_generation(&slot, requested_generation)?;
    let stdout = String::from_utf8_lossy(&status.stdout);
    if !crate::feishu::parse_status(&stdout).configured {
        return Err("feishu.not_authorized".into());
    }
    // FEISHU-06：一次扫码时记下的主人优先；早期两次扫码接入的从用户授权里取
    let owner = crate::feishu_register::read_owner(&dir)
        .or_else(|| owner_open_id(&stdout))
        .ok_or_else(|| "feishu.not_authorized".to_owned())?;
    let app_id = crate::feishu::parse_status(&stdout)
        .app_id
        .ok_or("feishu.not_configured")?;
    crate::feishu_paths::claim_app(&app, &account, &assistant_id, &app_id)?;
    registry.claim(&account, &assistant_id, &app_id)?;
    crate::feishu_scope::invalidate(&slot);
    stop(&state);
    let generation = crate::feishu_scope::generation(&slot);
    let scope = ListenEnded {
        account,
        assistant_id,
        app_id,
        generation,
        error: None,
    };
    listener::start(app, slot.clone(), scope, owner, &dir)
}

#[tauri::command]
pub fn feishu_listen_stop(
    registry: tauri::State<'_, Arc<crate::feishu::FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<(), String> {
    let slot = registry.scoped(&account, &assistant_id)?;
    let _lifecycle = slot.6.lock().map_err(|_| "feishu.state_failed")?;
    crate::feishu_scope::invalidate(&slot);
    stop(&slot.4);
    crate::feishu_approvals::stop(&slot.5);
    Ok(())
}

/// 以机器人身份调用飞书开放接口（只限回复与卡片接口），返回 lark-cli 输出的 JSON
// Explicit IPC fields keep connection scope mandatory at the Tauri boundary.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn feishu_api(
    app: AppHandle,
    account: String,
    assistant_id: String,
    app_id: String,
    generation: u64,
    method: String,
    path: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !allowed_api(&method, &path) {
        return Err("feishu.api_forbidden".into());
    }
    let dir = crate::feishu_scope::receipt(&app, &account, &assistant_id, &app_id, generation)?;
    let guard = app
        .state::<Arc<crate::feishu::FeishuState>>()
        .scoped(&account, &assistant_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = guard.6.lock().map_err(|_| "feishu.state_failed")?;
        crate::feishu_scope::check_generation(&guard, generation)?;
        // DELETE 没有请求体
        let mut args = vec!["api", method.as_str(), path.as_str(), "--as", "bot"];
        if !body.is_null() {
            args.extend(["--data", "-"]);
        }
        let mut child = command(&dir, &args)?
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("feishu.run_failed: {e}"))?;
        if let Some(mut stdin) = child.stdin.take().filter(|_| !body.is_null()) {
            stdin
                .write_all(body.to_string().as_bytes())
                .map_err(|e| format!("feishu.run_failed: {e}"))?;
        }
        let out = child
            .wait_with_output()
            .map_err(|e| format!("feishu.run_failed: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let detail = stderr
                .lines()
                .chain(stdout.lines())
                .rfind(|l| !l.trim().is_empty());
            return Err(format!("feishu.api_failed: {}", detail.unwrap_or_default()));
        }
        if stdout.trim().is_empty() {
            return Ok(serde_json::Value::Null);
        }
        serde_json::from_str(&stdout).map_err(|e| format!("feishu.api_failed: {e}"))
    })
    .await
    .map_err(|e| format!("feishu.join_failed: {e}"))?
}

#[cfg(test)]
#[path = "feishu_gateway_tests.rs"]
mod tests;

pub(crate) fn send_owner_auth_message(
    dir: &std::path::Path,
    url: Option<&str>,
) -> Result<(), String> {
    crate::feishu_notice::send_owner_auth_message(dir, url)
}
