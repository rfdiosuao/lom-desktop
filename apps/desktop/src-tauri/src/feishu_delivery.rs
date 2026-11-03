//! FEISHU-DELIVERY-01: bounded fixed writes, no shell or implicit @file content.
use super::*;
use std::fs;
use std::path::PathBuf;

pub(super) fn writer(name: &str) -> bool {
    [
        "feishu_create_doc",
        "feishu_append_doc",
        "feishu_send_file",
        "feishu_send_image",
    ]
    .contains(&name)
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
fn plain(value: &str) -> String {
    format!(
        "<p>{}</p>",
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('\n', "<br/>")
    )
}
fn local(v: &Value, image: bool) -> Result<PathBuf, String> {
    let path = PathBuf::from(string(v, "path", 4096)?);
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(invalid());
    }
    // Resolve only a directly named regular file, never a symlink or special device.
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor)
            .map_err(|_| "feishu.file_unavailable")?
            .file_type()
            .is_symlink()
        {
            return Err("feishu.file_unavailable".into());
        }
    }
    let meta = fs::metadata(&path).map_err(|_| "feishu.file_unavailable")?;
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let supported = if image {
        ["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str())
    } else {
        [
            "pdf", "md", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip",
        ]
        .contains(&ext.as_str())
    };
    if !meta.is_file()
        || meta.len() == 0
        || meta.len() > (if image { 10 } else { 20 }) * 1024 * 1024
        || !supported
    {
        return Err("feishu.file_unsupported".into());
    }
    Ok(path)
}
pub(super) fn build(name: &str, v: &Value) -> Result<Vec<String>, String> {
    let media = name.starts_with("feishu_send_");
    let allowed = if media {
        vec!["chat_id", "user_id", "path"]
    } else if name == "feishu_create_doc" {
        vec!["title", "content"]
    } else {
        vec!["doc_token", "content"]
    };
    if v.as_object()
        .ok_or_else(invalid)?
        .keys()
        .any(|k| !allowed.contains(&k.as_str()))
    {
        return Err(invalid());
    }
    let mut args = vec![
        if media { "im" } else { "docs" }.into(),
        if media {
            "+messages-send"
        } else if name == "feishu_create_doc" {
            "+create"
        } else {
            "+update"
        }
        .into(),
        "--as".into(),
        "user".into(),
    ];
    if media {
        args.push("--json".into());
        media_args(&mut args, v)?;
    } else {
        document_args(&mut args, name, v)?;
    }
    Ok(args)
}
fn media_args(args: &mut Vec<String>, v: &Value) -> Result<(), String> {
    if v.get("chat_id").is_some() == v.get("user_id").is_some() {
        return Err(invalid());
    }
    if v.get("chat_id").is_some() {
        required_id(args, v, "chat_id", "oc_", "--chat-id")?;
    } else {
        required_id(args, v, "user_id", "ou_", "--user-id")?;
    }
    let _ = string(v, "path", 4096)?;
    Ok(())
}
fn document_args(args: &mut Vec<String>, name: &str, v: &Value) -> Result<(), String> {
    let content = plain(string(v, "content", 12_000)?);
    if name == "feishu_create_doc" {
        let title = escape(string(v, "title", 200)?);
        add(
            args,
            "--content",
            &format!("<title>{title}</title>{content}"),
        );
    } else {
        required_id(args, v, "doc_token", "", "--doc")?;
        add(args, "--command", "append");
        add(args, "--content", &content);
    }
    add(args, "--doc-format", "xml");
    Ok(())
}

pub(super) fn execute(
    dir: &Path,
    name: &str,
    v: &Value,
    args: &[String],
    call_id: &str,
) -> Result<String, String> {
    if call_id.is_empty() || call_id.len() > 256 {
        return Err(invalid());
    }
    let path = if name.starts_with("feishu_send_") {
        Some(local(v, name == "feishu_send_image")?)
    } else {
        None
    };
    let mut args = args.to_vec();
    if let Some(path) = &path {
        let filename = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(invalid)?;
        add(
            &mut args,
            if name == "feishu_send_image" {
                "--image"
            } else {
                "--file"
            },
            &format!("./{filename}"),
        );
    }
    reserve(dir, call_id)?;
    let raw = cli::run_at(dir, &args, path.as_ref().and_then(|p| p.parent())).map_err(|e| {
        if e.starts_with("feishu.tool_failed") {
            "feishu.outcome_unknown".to_owned()
        } else {
            e
        }
    })?;
    outcome(name, &raw)?;
    Ok(raw)
}
#[path = "feishu_delivery_receipt.rs"]
mod receipt;
use receipt::reserve;

pub(super) fn outcome(name: &str, raw: &str) -> Result<Value, String> {
    let parsed: Value = serde_json::from_str(raw).map_err(|_| "feishu.outcome_unknown")?;
    normalize(raw, &json!({}))?;
    if parsed.get("dry_run") == Some(&json!(true)) {
        return Err("feishu.outcome_unknown".into());
    }
    let mut data = &parsed;
    while let Some(next) = data.get("data") {
        data = next;
    }
    if name.starts_with("feishu_send_") {
        let message = data.get("message").unwrap_or(data);
        let message_id = message
            .get("message_id")
            .and_then(Value::as_str)
            .filter(|v| id(v, "om_"))
            .ok_or("feishu.outcome_unknown")?;
        Ok(json!({"status":"sent", "message_id":message_id}))
    } else {
        let document = data.get("document").unwrap_or(data);
        let token = document
            .get("document_id")
            .or_else(|| document.get("doc_token"))
            .and_then(Value::as_str)
            .filter(|v| id(v, ""));
        if name == "feishu_create_doc" && token.is_none() {
            return Err("feishu.outcome_unknown".into());
        }
        if name == "feishu_append_doc"
            && (data.get("result").and_then(Value::as_str) != Some("success")
                || data
                    .get("updated_blocks_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    == 0)
        {
            return Err("feishu.outcome_unknown".into());
        }
        if data
            .get("warnings")
            .and_then(Value::as_array)
            .is_some_and(|w| !w.is_empty())
        {
            return Ok(json!({"status":"partial", "document_id":token, "review_required":true}));
        }
        if parsed.get("ok") != Some(&json!(true)) {
            return Err("feishu.outcome_unknown".into());
        }
        Ok(
            json!({"status":if name == "feishu_create_doc" { "created" } else { "appended" }, "document_id":token, "url":document.get("url")}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_delivery_01_content_is_literal_and_no_permission_mutation() {
        let args = build(
            "feishu_create_doc",
            &json!({"title":"Report", "content":"@/etc/passwd\n<img href='x'>"}),
        )
        .unwrap();
        assert!(args.contains(
            &"<title>Report</title><p>@/etc/passwd<br/>&lt;img href='x'&gt;</p>".to_owned()
        ));
        assert!(!args.contains(&"--yes".to_owned()));
        assert!(build(
            "feishu_append_doc",
            &json!({"doc_token":"abc", "content":"x", "permissions":"public"})
        )
        .is_err());
    }
    #[test]
    fn feishu_delivery_01_replay_and_local_paths_fail_closed() {
        let dir = std::env::temp_dir().join(format!("lom-delivery-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir(&dir).unwrap();
        reserve(dir.as_path(), "call-1").unwrap();
        assert_eq!(
            reserve(dir.as_path(), "call-1"),
            Err("feishu.outcome_unknown".into())
        );
        let path = dir.as_path().canonicalize().unwrap().join("report.md");
        fs::write(&path, "report").unwrap();
        assert!(local(&json!({"path":path}), false).is_ok());
        assert!(local(&json!({"path":path}), true).is_err());
        assert!(local(&json!({"path":"/dev/null"}), false).is_err());
        assert!(local(&json!({"path":"report.md"}), false).is_err());
        assert!(local(&json!({"path":dir.as_path().join("../secret.md")}), false).is_err());
        #[cfg(unix)]
        {
            let link = dir.as_path().join("link.md");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(local(&json!({"path":link}), false).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn feishu_delivery_01_upload_is_not_delivery_and_unknown_is_not_success() {
        assert!(outcome(
            "feishu_send_file",
            r#"{"ok":true,"data":{"file_key":"file_a"}}"#
        )
        .is_err());
        assert_eq!(
            outcome(
                "feishu_send_image",
                r#"{"ok":true,"data":{"message_id":"om_a"}}"#
            )
            .unwrap()["status"],
            "sent"
        );
        assert!(outcome("feishu_create_doc", r#"{"ok":true,"data":{}}"#).is_err());
        assert!(outcome("feishu_append_doc", "{}").is_err());
        assert_eq!(
            outcome(
                "feishu_create_doc",
                r#"{"ok":false,"error":{"message":"permission denied"}}"#
            ),
            Err("feishu.scope_missing".into())
        );
        assert!(outcome(
            "feishu_append_doc",
            r#"{"ok":true,"data":{"result":"partial_success","updated_blocks_count":1}}"#
        )
        .is_err());
        assert_eq!(
            outcome(
                "feishu_append_doc",
                r#"{"ok":true,"data":{"result":"success","updated_blocks_count":1}}"#
            )
            .unwrap()["status"],
            "appended"
        );
    }
}
