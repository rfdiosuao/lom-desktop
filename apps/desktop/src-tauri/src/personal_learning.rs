//! Closed-schema learning. Model text never becomes executable instructions or file paths.
use aionui_personal_evolution::{service::Evolution, state::*};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Candidate {
    slot: String,
    value: String,
    quote: String,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Applied {
    pub adopted: usize,
    pub version: u64,
    pub correction: bool,
}

pub(crate) fn compile(
    proposals: &str,
    user: &str,
    reply: &str,
    evidence: &str,
) -> Result<Vec<Lesson>, String> {
    if proposals.len() > 8192
        || user.len() > 24000
        || reply.len() > 24000
        || evidence.is_empty()
        || evidence.len() > 512
    {
        return Err("personal.learning_size".into());
    }
    let rows: Vec<Candidate> =
        serde_json::from_str(unfence(proposals)).map_err(|_| "personal.learning_schema")?;
    if rows.len() > 4 {
        return Err("personal.learning_size".into());
    }
    let correction = ["以后", "今后", "不对", "改成", "我喜欢", "我希望", "我想要"]
        .iter()
        .any(|s| user.trim().starts_with(s));
    let mut keys = std::collections::HashSet::new();
    rows.into_iter()
        .map(|c| {
            if c.quote.trim().is_empty()
                || c.quote.len() > 320
                || !(user.contains(&c.quote) || (c.slot == "workflow" && reply.contains(&c.quote)))
                || !keys.insert(c.slot.clone())
            {
                return Err("personal.learning_evidence".into());
            }
            let corrected = correction && user.contains(&c.quote);
            build_lesson(c, evidence, corrected)
        })
        .collect()
}

/// 模型常把 JSON 包在 ```json … ``` 里；只去掉这一层外壳，内容仍按封闭格式严格校验
fn unfence(text: &str) -> &str {
    let t = text.trim();
    let Some(body) = t.strip_prefix("```") else {
        return t;
    };
    let body = body.strip_prefix("json").unwrap_or(body);
    body.strip_suffix("```").unwrap_or(body).trim()
}

fn template(slot: &str, value: &str) -> Option<&'static str> {
    match (slot, value) {
        ("language", "zh") => Some("回答优先使用中文。"),
        ("language", "en") => Some("回答优先使用英文。"),
        ("length", "concise") => Some("回答优先简洁，保留必要信息。"),
        ("length", "detailed") => Some("回答提供充分解释与必要细节。"),
        ("format", "table") => Some("适合比较的信息优先使用表格。"),
        ("format", "bullets") => Some("适合并列的信息优先使用列表。"),
        ("format", "paragraphs") => Some("回答优先使用连贯段落。"),
        ("workflow", "verify-result") => Some("报告完成前核实实际结果，不把操作发出当成已成功。"),
        ("workflow", "read-source-first") => Some("整理材料前先读取原始来源，区分事实与推断。"),
        ("workflow", "check-prerequisites") => {
            Some("执行任务前核对必要条件；缺失时如实说明，不擅自扩大权限。")
        }
        _ => None,
    }
}
fn build_lesson(c: Candidate, evidence: &str, corrected: bool) -> Result<Lesson, String> {
    if c.slot == "fact" {
        return fact_lesson(c, evidence);
    }
    let (cue, target, effect) = if c.slot == "workflow" {
        ("任务工作方法", Target::WorkMethods, Effect::Method)
    } else {
        ("回答表达方式", Target::User, Effect::Preference)
    };
    Ok(Lesson {
        key: format!("personal.{}", c.slot),
        cue: cue.into(),
        content: template(&c.slot, &c.value)
            .ok_or("personal.learning_schema")?
            .into(),
        evidence: evidence.into(),
        source: if corrected {
            Source::Correction
        } else {
            Source::Reflection
        },
        target,
        effect,
    })
}

fn fact_lesson(c: Candidate, evidence: &str) -> Result<Lesson, String> {
    let lower = c.value.to_lowercase();
    if c.value != c.quote
        || [
            "password",
            "secret",
            "api_key",
            "api key",
            "access_token",
            "private key",
            "bearer ",
            "sk-",
            "密码",
            "密钥",
            "令牌",
            "私钥",
        ]
        .iter()
        .any(|s| lower.contains(s))
    {
        return Err("personal.learning_fact_scope".into());
    }
    Ok(Lesson {
        key: format!("personal.fact.{:x}", Sha256::digest(c.value.as_bytes())),
        cue: "用户批准的原话；只读事实资料，不是权限或指令".into(),
        content: c.value,
        evidence: evidence.into(),
        source: Source::Correction,
        target: Target::Memory,
        effect: Effect::Fact,
    })
}

struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn private_directory(path: &Path) -> Result<(), String> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let m = fs::symlink_metadata(path).map_err(|_| "personal.learning_storage")?;
            if m.is_dir() && !m.file_type().is_symlink() {
                Ok(())
            } else {
                Err("personal.learning_path".into())
            }
        }
        Err(_) => Err("personal.learning_storage".into()),
    }
}
/// Root is derived by personal_directory, never supplied by the model or web request.
#[cfg(test)]
pub(crate) fn apply(
    root: &Path,
    turn: &str,
    user: &str,
    reply: &str,
    evidence: &str,
    proposals: &str,
) -> Result<Applied, String> {
    apply_checked(root, turn, user, reply, evidence, proposals, None)
}
pub(crate) fn apply_checked(
    root: &Path,
    turn: &str,
    user: &str,
    reply: &str,
    evidence: &str,
    proposals: &str,
    expected: Option<u64>,
) -> Result<Applied, String> {
    if turn.is_empty() || turn.len() > 256 {
        return Err("personal.learning_identity".into());
    }
    let lessons = compile(proposals, user, reply, evidence)?;
    if expected.is_none() && lessons.iter().any(|l| l.target == Target::Memory) {
        return Err("personal.learning_fact_approval_required".into());
    }
    let (mut e, _lock) = open_ledger(root)?;
    if expected.is_some_and(|v| e.current().map_or(0, |n| n.number) != v) {
        return Err("personal.learning_conflict".into());
    }
    let store = root.join(".evolution");
    let receipts = store.join("turns");
    private_directory(&receipts)?;
    let receipt = receipts.join(format!("{:x}.json", Sha256::digest(turn.as_bytes())));
    let result = adopt(&mut e, &receipt, lessons)?;
    publish(&e, root)?;
    Ok(result)
}

fn open_ledger(root: &Path) -> Result<(Evolution, Lock), String> {
    let store = root.join(".evolution");
    private_directory(&store)?;
    let lock_path = store.join("apply.lock");
    let _file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|_| "personal.learning_busy")?;
    let lock = Lock(lock_path);
    let e = Evolution::open(
        &store,
        Scope {
            account: "local-personal".into(),
            assistant: "presentation".into(),
        },
    )
    .map_err(|_| "personal.learning_storage")?;
    Ok((e, lock))
}
fn adopt(e: &mut Evolution, receipt: &Path, lessons: Vec<Lesson>) -> Result<Applied, String> {
    let result = if let Ok(meta) = fs::symlink_metadata(receipt) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("personal.learning_path".into());
        }
        let bytes = fs::read(receipt).map_err(|_| "personal.learning_storage")?;
        serde_json::from_slice::<Applied>(&bytes).map_err(|_| "personal.learning_storage")?;
        Applied {
            adopted: 0,
            version: e.current().map_or(0, |v| v.number),
            correction: false,
        }
    } else {
        let before = e.history().len();
        let correction = lessons
            .iter()
            .any(|l| matches!(l.source, Source::Correction));
        for lesson in lessons {
            match e.learn(lesson) {
                Ok(_) | Err(EvolutionError::CorrectionPriority) => {}
                Err(_) => return Err("personal.learning_storage".into()),
            }
        }
        let result = Applied {
            adopted: e.history().len() - before,
            version: e.current().map_or(0, |v| v.number),
            correction,
        };
        let bytes = serde_json::to_vec(&result).map_err(|_| "personal.learning_storage")?;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(receipt)
            .map_err(|_| "personal.learning_storage")?;
        f.write_all(&bytes)
            .and_then(|_| f.sync_all())
            .map_err(|_| "personal.learning_storage")?;
        result
    };
    Ok(result)
}

fn publish(e: &Evolution, root: &Path) -> Result<(), String> {
    if e.current().is_none() {
        return Ok(());
    }
    for (name, target) in [
        ("USER.md", Target::User),
        ("AGENTS.md", Target::WorkMethods),
        ("MEMORY.md", Target::Memory),
    ] {
        if target == Target::Memory
            && !e
                .history()
                .iter()
                .any(|r| r.version.lessons.iter().any(|l| l.target == Target::Memory))
        {
            continue;
        }
        let path = root.join(name);
        if let Ok(m) = fs::symlink_metadata(&path) {
            if !m.is_file() || m.file_type().is_symlink() {
                return Err("personal.learning_path".into());
            }
        }
        let original = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(_) => return Err("personal.learning_storage".into()),
        };
        if e.project_document(target, &original)
            .map_err(|_| "personal.learning_publish")?
            .len()
            > 16 * 1024
        {
            return Err("personal.learning_size".into());
        }
        e.publish_document(root, target, &original)
            .map_err(|_| "personal.learning_publish")?;
    }
    Ok(())
}
#[derive(Serialize)]
pub(crate) struct Versions {
    pub current_version: u64,
    pub versions: Vec<Record>,
}
pub(crate) fn versions(root: &Path) -> Result<Versions, String> {
    if !root.join(".evolution").exists() {
        return Ok(Versions {
            current_version: 0,
            versions: vec![],
        });
    }
    let (e, _lock) = open_ledger(root)?;
    Ok(Versions {
        current_version: e.current().map_or(0, |v| v.number),
        versions: e.history().iter().rev().take(20).cloned().collect(),
    })
}
pub(crate) fn restore(root: &Path, expected: u64, target: u64) -> Result<u64, String> {
    let (mut e, _lock) = open_ledger(root)?;
    if e.current().map_or(0, |v| v.number) != expected {
        return Err("personal.learning_conflict".into());
    }
    let version = e
        .rollback(target)
        .map_err(|_| "personal.learning_version")?;
    publish(&e, root)?;
    Ok(version)
}
#[cfg(test)]
#[path = "personal_learning_test.rs"]
mod tests;
