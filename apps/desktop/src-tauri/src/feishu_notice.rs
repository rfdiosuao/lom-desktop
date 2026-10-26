//! Trusted owner-only notices. No arbitrary receiver or raw API surface.
use crate::feishu::{command, official_url, parse_status};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

/// 查询参数必须走 `--params`：lark-cli 拒绝路径里带 `?`
fn run_api(
    dir: &Path,
    method: &str,
    path: &str,
    params: Value,
    body: Value,
) -> Result<Value, String> {
    let params = params.to_string();
    let mut args = vec![method, path];
    // 没有查询参数时不带 --params
    if params != "null" {
        args.extend(["--params", params.as_str()]);
    }
    args.extend(["--as", "bot", "--data", "-"]);
    let mut child = command(dir, &[&["api"], args.as_slice()].concat())?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "feishu.notice_failed")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(body.to_string().as_bytes())
            .map_err(|_| "feishu.notice_failed")?;
    }
    let stdout = child.stdout.take().ok_or("feishu.notice_failed")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("feishu.notice_failed".into());
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "feishu.notice_failed")?
        .map_err(|_| "feishu.notice_failed")?;
    if !status.success() || bytes.len() > 65536 {
        return Err("feishu.notice_failed".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "feishu.notice_failed")?;
    if value
        .get("code")
        .and_then(Value::as_i64)
        .is_some_and(|x| x != 0)
    {
        return Err("feishu.notice_failed".into());
    }
    Ok(value)
}
fn owner_notice(dir: &Path, card: Value) -> Result<Value, String> {
    let owner = crate::feishu_register::read_owner(dir).ok_or("feishu.owner_missing")?;
    run_api(
        dir,
        "POST",
        "/open-apis/im/v1/messages",
        json!({"receive_id_type":"open_id"}),
        json!({"receive_id":owner,"msg_type":"interactive","content":card.to_string()}),
    )
}
pub(crate) fn send_owner_auth_message(dir: &Path, url: Option<&str>) -> Result<(), String> {
    let card = if let Some(url) = url {
        let url = official_url(url).ok_or("feishu.auth_url_invalid")?;
        json!({"schema":"2.0","body":{"elements":[{"tag":"markdown","content":"请在飞书官方页面授权。授权范围以官方页面为准。"},{"tag":"button","text":{"tag":"plain_text","content":"去授权"},"type":"primary","url":url}]}})
    } else {
        json!({"schema":"2.0","body":{"elements":[{"tag":"markdown","content":"授权状态已保存。可用能力仍受实际授权范围与助理权限限制。"}]}})
    };
    owner_notice(dir, card).map(|_| ())
}
type Notice = (String, String, u64, String, String, Instant);
static NOTICES: OnceLock<Mutex<HashMap<String, Notice>>> = OnceLock::new();
fn find_id(value: &Value, depth: usize) -> Option<String> {
    if depth > 5 {
        return None;
    }
    let object = value.as_object()?;
    if let Some(id) = object.get("message_id").and_then(Value::as_str) {
        return id.starts_with("om_").then(|| id.into());
    }
    object.values().find_map(|v| find_id(v, depth + 1))
}
pub(crate) fn valid_callback(
    account: &str,
    assistant: &str,
    generation: u64,
    app_id: &str,
    nonce: &str,
    message_id: &str,
) -> bool {
    NOTICES
        .get_or_init(Default::default)
        .lock()
        .map(|m| {
            m.get(nonce).is_some_and(|(a, owner, epoch, b, id, t)| {
                a == account
                    && owner == assistant
                    && *epoch == generation
                    && b == app_id
                    && id == message_id
                    && t.elapsed() < Duration::from_secs(1800)
            })
        })
        .unwrap_or(false)
}
fn approval_card(nonce: &str, summary: &str) -> Result<Value, String> {
    if nonce.len() != 32
        || !nonce.bytes().all(|b| b.is_ascii_hexdigit())
        || summary.is_empty()
        || summary.len() > 16000
    {
        return Err("feishu.approval_invalid".into());
    }
    Ok(
        json!({"schema":"2.0","body":{"elements":[{"tag":"markdown","content":summary},{"tag":"markdown","content":format!("审批编号：{nonce}\n如按钮无响应，请完整回复：允许 {nonce} 或 拒绝 {nonce}。30 分钟内有效。")},{"tag":"column_set","columns":[{"tag":"column","width":"weighted","elements":[{"tag":"button","text":{"tag":"plain_text","content":"允许一次"},"type":"primary","value":{"nonce":nonce,"decision":"once"}}]},{"tag":"column","width":"weighted","elements":[{"tag":"button","text":{"tag":"plain_text","content":"拒绝"},"value":{"nonce":nonce,"decision":"deny"}}]}]}]}}),
    )
}
#[tauri::command]
pub async fn feishu_owner_notice(
    app: tauri::AppHandle,
    account: String,
    assistant_id: String,
    generation: u64,
    app_id: String,
    nonce: String,
    summary: String,
) -> Result<Value, String> {
    let dir = crate::feishu_scope::receipt(&app, &account, &assistant_id, &app_id, generation)?;
    let guard = app
        .state::<Arc<crate::feishu::FeishuState>>()
        .scoped(&account, &assistant_id)?;
    let card = approval_card(&nonce, &summary)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::feishu_scope::check_generation(&guard, generation)?;
        let out = command(&dir, &["auth", "status", "--json"])?
            .output()
            .map_err(|_| "feishu.status_failed")?;
        let status = parse_status(&String::from_utf8_lossy(&out.stdout));
        if !out.status.success() || status.app_id.as_deref() != Some(app_id.as_str()) {
            return Err("feishu.binding_changed".into());
        }
        let result = crate::feishu_scope::with_generation(&guard, generation, || owner_notice(&dir, card)).or_else(|_| {
            crate::feishu_scope::check_generation(&guard, generation)?;
            let owner = crate::feishu_register::read_owner(&dir).ok_or("feishu.owner_missing")?;
            crate::feishu_scope::with_generation(&guard, generation, || run_api(&dir, "POST", "/open-apis/im/v1/messages", json!({"receive_id_type":"open_id"}), json!({"receive_id":owner,"msg_type":"text","content":json!({"text":format!("{summary}\n请完整回复：允许 {nonce} 或 拒绝 {nonce}。30分钟内有效。")}).to_string()})))
        })?;
        crate::feishu_scope::check_generation(&guard, generation)?;
        let message_id = find_id(&result, 0).ok_or("feishu.notice_unconfirmed")?;
        let mut notices = NOTICES
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "feishu.notice_failed")?;
        notices.retain(|_, (_, _, _, _, _, time)| time.elapsed() < Duration::from_secs(1800));
        if notices.len() >= 1024 {
            return Err("feishu.notice_capacity".into());
        }
        notices.insert(nonce, (account, assistant_id, generation, app_id, message_id, Instant::now()));
        Ok(result)
    })
    .await
    .map_err(|_| "feishu.notice_failed")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_07_cards_have_only_once_and_deny_with_exact_nonce() {
        let value = approval_card(&"a".repeat(32), "向指定用户发送已审核消息").unwrap();
        let s = value.to_string();
        assert!(s.contains("允许一次") && s.contains("拒绝"));
        assert!(!s.contains("proceed_always"));
        assert!(approval_card("bad;command", "x").is_err());
        assert!(approval_card(&"a".repeat(32), &"x".repeat(16001)).is_err());
    }
}

#[tauri::command]
pub async fn feishu_notice_finish(
    app: tauri::AppHandle,
    account: String,
    assistant_id: String,
    generation: u64,
    app_id: String,
    nonce: String,
    outcome: String,
) -> Result<(), String> {
    let label = match outcome.as_str() {
        "allowed" => "已允许一次",
        "denied" => "已拒绝",
        "expired" => "已过期，请重新发起",
        "resolved" => "已在电脑上处理或请求已失效",
        "failed" => "未确认执行结果，请在电脑上核对",
        _ => return Err("feishu.approval_invalid".into()),
    };
    let message_id = {
        let m = NOTICES
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "feishu.notice_failed")?;
        let Some((a, owner, epoch, b, id, _)) = m.get(&nonce) else {
            return Err("feishu.approval_invalid".into());
        };
        if a != &account || owner != &assistant_id || *epoch != generation || b != &app_id {
            return Err("feishu.approval_invalid".into());
        }
        id.clone()
    };
    let dir = crate::feishu_scope::receipt(&app, &account, &assistant_id, &app_id, generation)?;
    let guard = app
        .state::<Arc<crate::feishu::FeishuState>>()
        .scoped(&account, &assistant_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::feishu_scope::check_generation(&guard, generation)?;
        let out = command(&dir, &["auth", "status", "--json"])?
            .output()
            .map_err(|_| "feishu.status_failed")?;
        if !out.status.success()
            || parse_status(&String::from_utf8_lossy(&out.stdout))
                .app_id
                .as_deref()
                != Some(app_id.as_str())
        {
            return Err("feishu.binding_changed".into());
        }
        let card = json!({"schema":"2.0","body":{"elements":[{"tag":"markdown","content":label}]}});
        crate::feishu_scope::with_generation(&guard, generation, || {
            run_api(
                &dir,
                "PATCH",
                &format!("/open-apis/im/v1/messages/{message_id}"),
                Value::Null,
                json!({"content":card.to_string()}),
            )
        })
        .map(|_| ())
    })
    .await
    .map_err(|_| "feishu.notice_failed")?
}
