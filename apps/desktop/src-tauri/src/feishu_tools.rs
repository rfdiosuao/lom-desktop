//! FEISHU-09: fixed user-identity commands. Arguments never pass through a shell.
use serde_json::{json, Value};
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tauri::Manager;

const BUDGET: usize = 30_000;
const RAW_LIMIT: u64 = 4 * 1024 * 1024;
fn invalid() -> String {
    "feishu.invalid_args".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_09_ac2_fixed_user_commands() {
        let args = build_args("feishu_read_messages", &json!({"chat_id":"oc_abc"})).unwrap();
        assert_eq!(&args[..2], &["im", "+chat-messages-list"]);
        assert!(args.windows(2).any(|v| v == ["--as", "user"]));
        assert!(!args.iter().any(|v| v == "--page-all"));
    }
    #[test]
    fn feishu_09_ac5_rejects_unknown_fields_injection_and_ids() {
        for args in [
            json!({"query":"x; whoami"}),
            json!({"query":"$(id)"}),
            json!({"query":"x","api":"anything"}),
            json!({"query":"x".repeat(501)}),
        ] {
            assert!(build_args("feishu_search_docs", &args).is_err());
        }
        assert!(build_args("feishu_read_messages", &json!({"chat_id":"oc_a;bad"})).is_err());
        assert!(build_args("api", &json!({})).is_err());
        assert!(build_args(
            "feishu_send_message",
            &json!({"chat_id":"oc_a", "text":"@/etc/passwd"})
        )
        .is_err());
    }
    #[test]
    fn feishu_09_ac2_utf8_budget_and_continuation_do_not_skip_rows() {
        let input = json!({"data":{"items":(0..100).map(|i|json!({"message_id":format!("om_{i}"),"content":"文".repeat(1000)})).collect::<Vec<_>>(),"has_more":true,"page_token":"next"}});
        let first = normalize(&input.to_string(), &json!({})).unwrap();
        assert!(first.to_string().len() <= BUDGET);
        assert!(first["next"]["offset"].as_u64().unwrap() > 0);
        let next = normalize(&input.to_string(), &first["next"]).unwrap();
        assert_ne!(
            first["items"][0]["message_id"],
            next["items"][0]["message_id"]
        );
    }
}

fn string<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.chars().count() <= max && !s.contains('\0'))
        .ok_or_else(invalid)
}
fn id(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() > prefix.len()
        && value.len() <= 160
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn query(v: &Value) -> Result<&str, String> {
    let s = string(v, "query", 50)?;
    if s.contains([';', '|', '&', '`', '$', '<', '>', '\n', '\r']) {
        return Err(invalid());
    }
    Ok(s)
}
fn add(args: &mut Vec<String>, flag: &str, value: &str) {
    args.extend([flag.to_owned(), value.to_owned()]);
}
fn required_id(
    args: &mut Vec<String>,
    v: &Value,
    key: &str,
    prefix: &str,
    flag: &str,
) -> Result<(), String> {
    let value = string(v, key, 160)?;
    if !id(value, prefix) {
        return Err(invalid());
    }
    add(args, flag, value);
    Ok(())
}
type CommandDefinition = (&'static str, &'static str, Vec<&'static str>);
fn definition(name: &str, v: &Value) -> Result<CommandDefinition, String> {
    Ok(match name {
        "feishu_search_docs" => ("docs", "+search", vec!["query"]),
        "feishu_read_doc" => ("docs", "+fetch", vec!["doc"]),
        "feishu_list_chats" => ("im", "+chat-list", vec![]),
        "feishu_search_chats" => ("im", "+chat-search", vec!["query"]),
        "feishu_read_messages" => ("im", "+chat-messages-list", vec!["chat_id"]),
        "feishu_search_messages" => ("im", "+messages-search", vec!["query", "chat_id"]),
        "feishu_chat_members" => ("im", "+chat-members-list", vec!["chat_id"]),
        "feishu_find_people" => (
            "contact",
            if v.get("user_id").is_some() {
                "+get-user"
            } else {
                "+search-user"
            },
            vec!["query", "user_id"],
        ),
        "feishu_send_message" => ("im", "+messages-send", vec!["chat_id", "user_id", "text"]),
        _ => return Err(invalid()),
    })
}

fn build_args(name: &str, v: &Value) -> Result<Vec<String>, String> {
    let (group, action, fields) = definition(name, v)?;
    let object = v.as_object().ok_or_else(invalid)?;
    if object.keys().any(|k| {
        !fields.contains(&k.as_str())
            && !["page_size", "page_token", "offset"].contains(&k.as_str())
    }) {
        return Err(invalid());
    }
    let mut args = vec![group.into(), action.into(), "--as".into(), "user".into()];
    match name {
        "feishu_search_docs" | "feishu_search_chats" | "feishu_search_messages" => {
            add(&mut args, "--query", query(v)?)
        }
        "feishu_read_doc" => {
            let doc = string(v, "doc", 160)?;
            if !id(doc, "") {
                return Err(invalid());
            }
            add(&mut args, "--doc", doc);
            add(&mut args, "--doc-format", "markdown");
        }
        "feishu_find_people" => {
            if v.get("user_id").is_some() {
                if v.get("query").is_some() {
                    return Err(invalid());
                }
                required_id(&mut args, v, "user_id", "ou_", "--user-id")?;
            } else {
                add(&mut args, "--query", query(v)?);
            }
        }
        _ => {}
    }
    if ["feishu_read_messages", "feishu_chat_members"].contains(&name) || v.get("chat_id").is_some()
    {
        required_id(&mut args, v, "chat_id", "oc_", "--chat-id")?;
    }
    if name == "feishu_send_message" {
        if v.get("chat_id").is_some() == v.get("user_id").is_some() {
            return Err(invalid());
        }
        if v.get("user_id").is_some() {
            required_id(&mut args, v, "user_id", "ou_", "--user-id")?;
        }
        let text = string(v, "text", 5000)?;
        // The CLI interprets @file and '-' even without a shell.
        if text.trim_start().starts_with('@') || text.trim() == "-" {
            return Err(invalid());
        }
        add(&mut args, "--text", text);
    }
    options(&mut args, name, v)?;
    Ok(args)
}
fn options(args: &mut Vec<String>, name: &str, v: &Value) -> Result<(), String> {
    let paged = !["feishu_read_doc", "feishu_send_message"].contains(&name)
        && !args.iter().any(|s| s == "+get-user");
    if v.get("offset")
        .is_some_and(|n| n.as_u64().is_none_or(|x| x > 4_000_000))
    {
        return Err(invalid());
    }
    if !paged && (v.get("page_size").is_some() || v.get("page_token").is_some()) {
        return Err(invalid());
    }
    if paged {
        let max = if name == "feishu_search_docs" {
            20
        } else if name == "feishu_find_people" {
            30
        } else {
            50
        };
        let n = match v.get("page_size") {
            Some(n) => n
                .as_u64()
                .filter(|n| *n > 0 && *n <= max)
                .ok_or_else(invalid)?,
            None => 20,
        };
        add(args, "--page-size", &n.to_string());
        if v.get("page_token").is_some() {
            if name == "feishu_find_people" {
                return Err(invalid());
            }
            let token = string(v, "page_token", 2048)?;
            if !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-=+/.:".contains(&b))
            {
                return Err(invalid());
            }
            add(args, "--page-token", token);
        }
    }
    if name == "feishu_list_chats" {
        add(args, "--types", "group,p2p");
        add(args, "--sort", "active_time");
    }
    if name == "feishu_read_messages" {
        add(args, "--order", "desc");
    }
    if ["feishu_read_messages", "feishu_search_messages"].contains(&name) {
        args.push("--no-reactions".into());
    }
    if name != "feishu_read_doc" {
        args.push("--json".into());
    }
    Ok(())
}

#[path = "feishu_tool_output.rs"]
mod output;
use output::{document, normalize};
fn classify_error(raw: &str) -> String {
    let text = raw.to_ascii_lowercase();
    if [
        "unauthorized",
        "token expired",
        "99991663",
        "need_user_auth",
        "not logged in",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        "feishu.need_user_auth".into()
    } else if ["scope", "permission", "99991672"]
        .iter()
        .any(|s| text.contains(s))
    {
        "feishu.scope_missing".into()
    } else {
        "feishu.tool_failed".into()
    }
}
fn run_cli(dir: &Path, args: &[String]) -> Result<String, String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut child = crate::feishu::command(dir, &refs)?
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "feishu.tool_failed".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "feishu.tool_failed".to_owned())?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(RAW_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("feishu.tool_failed: timeout".into());
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "feishu.tool_failed".to_owned())?
        .map_err(|_| "feishu.tool_failed".to_owned())?;
    if bytes.len() as u64 > RAW_LIMIT {
        return Err("feishu.output_too_large".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "feishu.tool_failed".to_owned())?;
    if !status.success() {
        return Err(classify_error(&text));
    }
    Ok(text)
}

// Explicit IPC fields keep connection scope mandatory at the Tauri boundary.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn feishu_tool_execute(
    app: tauri::AppHandle,
    account: String,
    assistant_id: String,
    generation: u64,
    app_id: String,
    name: String,
    arguments: Value,
    call_id: String,
) -> Result<Value, String> {
    let mut args = build_args(&name, &arguments)?;
    let dir = crate::feishu_scope::receipt(&app, &account, &assistant_id, &app_id, generation)?;
    let guard = app
        .state::<std::sync::Arc<crate::feishu::FeishuState>>()
        .scoped(&account, &assistant_id)?;
    if name == "feishu_send_message" {
        use sha2::{Digest, Sha256};
        if call_id.is_empty() || call_id.len() > 256 {
            return Err(invalid());
        }
        let digest =
            Sha256::digest(format!("{account}:{assistant_id}:{app_id}:{call_id}").as_bytes());
        let key: String = digest.iter().take(24).map(|b| format!("{b:02x}")).collect();
        add(&mut args, "--idempotency-key", &key);
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::feishu_scope::check_generation(&guard, generation)?;
        let status = run_cli(&dir, &["auth".into(), "status".into(), "--json".into()])?;
        let owner = crate::feishu_register::read_owner(&dir).ok_or("feishu.need_user_auth")?;
        if crate::feishu_gateway::owner_open_id(&status).as_deref() != Some(owner.as_str()) {
            return Err("feishu.need_user_auth".into());
        }
        let status = crate::feishu::parse_status(&status);
        if status.app_id.as_deref() != Some(app_id.as_str()) {
            return Err("feishu.binding_invalid".into());
        }
        if !status.authorized {
            return Err("feishu.need_user_auth".into());
        }
        let raw =
            crate::feishu_scope::with_generation(&guard, generation, || run_cli(&dir, &args))?;
        let result = if name == "feishu_read_doc" {
            document(&raw, &arguments)?
        } else {
            normalize(&raw, &arguments)?
        };
        if result.to_string().len() > BUDGET {
            return Err("feishu.output_too_large".into());
        }
        crate::feishu_scope::check_generation(&guard, generation)?;
        Ok(result)
    })
    .await
    .map_err(|_| "feishu.tool_failed".to_owned())?
}
