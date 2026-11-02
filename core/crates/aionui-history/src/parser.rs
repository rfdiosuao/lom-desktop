use crate::HistoryError;
use aionui_api_types::history_import::{HistoryEntry, HistoryEvent, HistorySource};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{BufRead, Read};

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn text_blocks(value: &Value) -> String {
    if let Some(s) = value.as_str() {
        return s.to_owned();
    }
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.get("text").or_else(|| v.get("thinking")).and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
fn event(entry: &mut HistoryEntry, line: &[u8], number: usize) -> Option<HistoryEvent> {
    if line.iter().all(u8::is_ascii_whitespace) {
        return None;
    }
    let value: Value = match serde_json::from_slice(line) {
        Ok(v) => v,
        Err(_) => {
            entry.warnings.push("malformed_lines_raw_preserved".into());
            return None;
        }
    };
    let kind = value["type"].as_str().unwrap_or("unknown");
    let payload = match entry.source {
        HistorySource::Codex => &value["payload"],
        HistorySource::Claude => &value["message"],
    };
    if entry.timestamp.is_empty() {
        entry.timestamp = value["timestamp"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(128)
            .collect();
    }
    if entry.cwd.is_empty() {
        entry.cwd = value["cwd"]
            .as_str()
            .or(payload["cwd"].as_str())
            .unwrap_or_default()
            .chars()
            .take(4096)
            .collect();
    }
    if entry.session_id.is_empty() {
        entry.session_id = match entry.source {
            HistorySource::Codex if kind == "session_meta" => payload["id"].as_str(),
            HistorySource::Claude => value["sessionId"].as_str(),
            _ => None,
        }
        .unwrap_or_default()
        .chars()
        .take(256)
        .collect();
    }
    let role = payload["role"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(64)
        .collect::<String>();
    let mut text = text_blocks(&payload["content"]);
    if text.is_empty() {
        text = text_blocks(&payload["summary"]);
    }
    if entry.title.is_empty() && role == "user" {
        entry.title = crate::titles::clean_title(&text).unwrap_or_default();
    }
    if kind == "custom-title"
        && let Some(title) = value["customTitle"].as_str().and_then(crate::titles::clean_title)
    {
        entry.title = title;
    }
    if payload.get("encrypted_content").is_some() {
        entry.warnings.push("encrypted_content_unreadable".into());
    }
    if text.is_empty() {
        text = String::from_utf8_lossy(line).into_owned();
    }
    let sub = payload["type"].as_str().unwrap_or_default();
    Some(HistoryEvent {
        line: number,
        kind: format!("{kind}{}{sub}", if sub.is_empty() { "" } else { ":" })
            .chars()
            .take(256)
            .collect(),
        role,
        text,
    })
}
// Verified: ~/aion/protocols/samples/cli-history/2026-10-22/{codex,claude}.jsonl.
// Stream every raw byte through the hash. Only one bounded line/event is resident.
pub fn parse_reader(
    reader: impl BufRead,
    source: HistorySource,
    mut emit: impl FnMut(HistoryEvent) -> Result<(), HistoryError>,
) -> Result<HistoryEntry, HistoryError> {
    const LINE: usize = 1024 * 1024;
    let mut entry = HistoryEntry {
        id: String::new(),
        source,
        session_id: String::new(),
        title: String::new(),
        cwd: String::new(),
        timestamp: String::new(),
        digest: String::new(),
        bytes: 0,
        events: 0,
        warnings: vec!["attachments_are_references_only".into()],
    };
    let mut reader = reader;
    let mut hash = Sha256::new();
    let mut buffer = Vec::new();
    let mut overflow = false;
    let mut number = 1;
    loop {
        buffer.clear();
        let n = (&mut reader).take((LINE + 1) as u64).read_until(b'\n', &mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer);
        entry.bytes += n as u64;
        let newline = buffer.last() == Some(&b'\n');
        if n > LINE {
            overflow = true;
        }
        if !overflow && let Some(e) = event(&mut entry, &buffer, number) {
            entry.events += 1;
            emit(e)?;
        }
        if newline {
            if overflow {
                entry.warnings.push("large_lines_raw_preserved".into());
            }
            overflow = false;
            number += 1;
        }
        // Keep diagnostic memory bounded even for millions of malformed lines.
        entry.warnings.sort();
        entry.warnings.dedup();
    }
    if overflow {
        entry.warnings.push("large_lines_raw_preserved".into());
    }
    if entry.session_id.is_empty() {
        entry.warnings.push("missing_session_id".into());
    }
    if entry.title.is_empty() {
        entry.title = "未命名会话".into();
    }
    entry.warnings.sort();
    entry.warnings.dedup();
    entry.digest = format!("{:x}", hash.finalize());
    Ok(entry)
}
