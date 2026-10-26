//! Optional card callbacks; nonce-bearing private text remains the fallback.
use crate::feishu::{command, parse_status};
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct ApprovalGateway(Mutex<Option<(Child, ChildStdin)>>);
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct ApprovalAction {
    account: String,
    app_id: String,
    assistant_id: String,
    generation: u64,
    nonce: String,
    decision: String,
}
fn parse(line: &str, owner: &str, account: &str, app_id: &str) -> Option<ApprovalAction> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("operator_id")?.as_str()? != owner || v.get("type")?.as_str()? != "card.action.trigger"
    {
        return None;
    }
    let action: Value = serde_json::from_str(v.get("action_value")?.as_str()?).ok()?;
    let nonce = action.get("nonce")?.as_str()?;
    let decision = action.get("decision")?.as_str()?;
    if nonce.len() != 32
        || !nonce.bytes().all(|b| b.is_ascii_hexdigit())
        || !matches!(decision, "once" | "deny")
    {
        return None;
    }
    Some(ApprovalAction {
        account: account.into(),
        app_id: app_id.into(),
        assistant_id: String::new(),
        generation: 0,
        nonce: nonce.into(),
        decision: decision.into(),
    })
}
pub fn stop(state: &ApprovalGateway) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some((mut child, stdin)) = guard.take() {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
#[tauri::command]
pub async fn feishu_approvals_start(
    app: tauri::AppHandle,
    account: String,
    app_id: String,
    assistant_id: String,
    generation: u64,
) -> Result<(), String> {
    let dir = crate::feishu_scope::receipt(&app, &account, &assistant_id, &app_id, generation)?;
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
    let owner = crate::feishu_register::read_owner(&dir).ok_or("feishu.owner_missing")?;
    let registry = app.state::<Arc<crate::feishu::FeishuState>>();
    let slot = registry.scoped(&account, &assistant_id)?;
    let state = slot.5.clone();
    let _lifecycle = slot.6.lock().map_err(|_| "feishu.state_failed")?;
    crate::feishu_scope::check_generation(&slot, generation)?;
    stop(&state);
    let mut child = command(
        &dir,
        &["event", "consume", "card.action.trigger", "--as", "bot"],
    )?
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|_| "feishu.approval_listener_failed")?;
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("feishu.approval_listener_failed".into());
    };
    let pid = child.id();
    *state
        .0
        .lock()
        .map_err(|_| "feishu.approval_listener_failed")? = Some((child, stdin));
    drop(_lifecycle);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let gateway = state.clone();
            let current = gateway
                .0
                .lock()
                .map(|g| g.as_ref().is_some_and(|(c, _)| c.id() == pid))
                .unwrap_or(false);
            if !current {
                break;
            }
            if let Some(mut action) = parse(&line, &owner, &account, &app_id) {
                if crate::feishu_scope::generation(&slot) != generation {
                    break;
                }
                action.assistant_id = assistant_id.clone();
                action.generation = generation;
                let message_id = serde_json::from_str::<Value>(&line)
                    .ok()
                    .and_then(|v| {
                        v.get("message_id")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                    .unwrap_or_default();
                if !crate::feishu_notice::valid_callback(
                    &account,
                    &assistant_id,
                    generation,
                    &app_id,
                    &action.nonce,
                    &message_id,
                ) {
                    continue;
                }
                if app.emit("feishu-approval", action).is_err() {
                    log::warn!("feishu.approval_emit_failed");
                }
            }
        }
    });
    Ok(())
}
#[tauri::command]
pub fn feishu_approvals_stop(
    registry: tauri::State<'_, Arc<crate::feishu::FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<(), String> {
    let slot = registry.scoped(&account, &assistant_id)?;
    let _lifecycle = slot.6.lock().map_err(|_| "feishu.state_failed")?;
    stop(&slot.5);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_07_callback_filters_owner_and_rejects_persistent_approval() {
        let v = serde_json::json!({"type":"card.action.trigger","operator_id":"ou_owner","action_value":serde_json::json!({"nonce":"a".repeat(32),"decision":"once"}).to_string()});
        assert!(parse(&v.to_string(), "ou_owner", "a", "cli_a").is_some());
        assert!(parse(&v.to_string(), "ou_other", "a", "cli_a").is_none());
        let bad = v.to_string().replace("once", "always");
        assert!(parse(&bad, "ou_owner", "a", "cli_a").is_none());
    }
}
