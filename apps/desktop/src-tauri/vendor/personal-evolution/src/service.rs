use crate::state::*;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

/// Personal-only version ledger. Callers supply authenticated scope, never request-body ownership.
/// One append-only record is the commit boundary; in-memory state changes only after fsync.
pub struct Evolution {
    path: PathBuf,
    snapshot: Snapshot,
}
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
impl Evolution {
    pub fn open(root: &Path, scope: Scope) -> Result<Self, EvolutionError> {
        if scope.account.is_empty()
            || scope.assistant.is_empty()
            || scope.account.len() > 48
            || scope.assistant.len() > 48
        {
            return Err(EvolutionError::Invalid);
        }
        fs::create_dir_all(root).map_err(|_| EvolutionError::Storage)?;
        let path = root.join(format!("{}-{}.jsonl", hex(&scope.account), hex(&scope.assistant)));
        let snapshot = load(&path, &scope)?;
        Ok(Self { path, snapshot })
    }
    pub fn current(&self) -> Option<&Version> {
        self.snapshot.records.last().map(|r| &r.version)
    }
    pub fn history(&self) -> &[Record] {
        &self.snapshot.records
    }
    /// Both sources auto-apply. Corrections win over later autonomous reflections.
    pub fn learn(&mut self, lesson: Lesson) -> Result<u64, EvolutionError> {
        validate(&lesson)?;
        let mut version = self.current().cloned().unwrap_or(Version {
            number: 0,
            lessons: vec![],
            corrected: vec![],
        });
        if let Some(index) = version.lessons.iter().position(|l| l.key == lesson.key) {
            let old = &version.lessons[index];
            if old.source == Source::Correction && lesson.source == Source::Reflection {
                return Err(EvolutionError::CorrectionPriority);
            }
            if old == &lesson {
                return Ok(version.number);
            }
            if lesson.source == Source::Correction
                && old.content != lesson.content
                && !version.corrected.contains(&lesson.key)
            {
                version.corrected.push(lesson.key.clone());
            }
            version.lessons[index] = lesson;
        } else {
            version.lessons.push(lesson);
        }
        self.commit(version, "learn")
    }
    pub fn rollback(&mut self, number: u64) -> Result<u64, EvolutionError> {
        let version = self
            .snapshot
            .records
            .iter()
            .find(|r| r.version.number == number)
            .map(|r| r.version.clone())
            .ok_or(EvolutionError::MissingVersion)?;
        self.commit(version, "rollback")
    }
    fn commit(&mut self, mut version: Version, reason: &str) -> Result<u64, EvolutionError> {
        let lock_path = self.path.with_extension("lock");
        let _file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| EvolutionError::Conflict)?;
        let _lock = Lock(lock_path);
        let disk = load(&self.path, &self.snapshot.scope)?;
        if disk.records.len() != self.snapshot.records.len() {
            return Err(EvolutionError::Conflict);
        }
        let revision = disk.records.len() as u64 + 1;
        version.number = revision;
        let record = Record {
            revision,
            reason: reason.into(),
            version,
        };
        let mut bytes = serde_json::to_vec(&record).map_err(|_| EvolutionError::Storage)?;
        bytes.push(b'\n');
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|_| EvolutionError::Storage)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| EvolutionError::Storage)?;
        self.snapshot.records.push(record);
        Ok(revision)
    }
}
fn hex(s: &str) -> String {
    s.as_bytes().iter().map(|b| format!("{b:02x}")).collect()
}
fn load(path: &Path, scope: &Scope) -> Result<Snapshot, EvolutionError> {
    let text = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err(EvolutionError::Storage),
    };
    let mut records = vec![];
    for line in text.lines() {
        let r: Record = serde_json::from_str(line).map_err(|_| EvolutionError::Storage)?;
        if r.revision != records.len() as u64 + 1 || r.version.number != r.revision {
            return Err(EvolutionError::Storage);
        }
        records.push(r);
    }
    Ok(Snapshot {
        scope: scope.clone(),
        records,
    })
}
fn validate(l: &Lesson) -> Result<(), EvolutionError> {
    if [&l.key, &l.cue, &l.content, &l.evidence]
        .iter()
        .any(|s| s.trim().is_empty() || s.len() > 16384)
    {
        return Err(EvolutionError::Invalid);
    }
    if matches!(l.effect, Effect::Confirmation | Effect::Permission | Effect::Credential) {
        return Err(EvolutionError::Blocked);
    }
    Ok(())
}
