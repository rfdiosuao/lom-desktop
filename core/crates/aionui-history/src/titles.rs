use std::{collections::HashMap, io::Read, path::Path};

pub(crate) fn clean_title(value: &str) -> Option<String> {
    let mut text = value.trim();
    for tag in ["environment_context", "user_instructions", "permissions_instructions"] {
        let open = format!("<{tag}>");
        if text.starts_with(&open) {
            let close = format!("</{tag}>");
            text = text.split_once(&close)?.1.trim();
        }
    }
    if text.is_empty() || text.starts_with('<') || text.starts_with("# AGENTS.md instructions") {
        return None;
    }
    Some(
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(80)
            .collect(),
    )
}

/// Codex's own title index is optional, bounded and read-only. Never infer titles from configuration.
pub(crate) fn codex_titles(home: &Path) -> HashMap<String, String> {
    let path = home.join(".codex/session_index.jsonl");
    let Ok(meta) = std::fs::symlink_metadata(&path) else {
        return HashMap::new();
    };
    if !meta.is_file() || meta.len() > 16 * 1024 * 1024 {
        return HashMap::new();
    }
    let Ok(file) = std::fs::File::open(path) else {
        return HashMap::new();
    };
    let mut bytes = Vec::new();
    if file.take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes).is_err() || bytes.len() > 16 * 1024 * 1024 {
        return HashMap::new();
    }
    let mut titles = HashMap::new();
    for line in bytes.split(|b| *b == b'\n').filter(|line| line.len() <= 64 * 1024) {
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(line) else {
            continue;
        };
        if let (Some(id), Some(title)) = (
            value["id"].as_str(),
            value["thread_name"].as_str().and_then(clean_title),
        ) {
            titles.insert(id.to_owned(), title);
        }
    }
    titles
}
