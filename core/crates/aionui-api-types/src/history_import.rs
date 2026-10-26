use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistorySource {
    Codex,
    Claude,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub source: HistorySource,
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    pub timestamp: String,
    pub digest: String,
    pub bytes: u64,
    pub events: usize,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEvent {
    pub line: usize,
    pub kind: String,
    pub role: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct HistoryListing {
    pub entries: Vec<HistoryEntry>,
    pub diagnostics: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryScanRequest {
    pub sources: Vec<HistorySource>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryImportRequest {
    pub entries: Vec<HistoryEntry>,
}
#[derive(Serialize, Deserialize, Default)]
pub struct HistoryImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub struct HistoryPage {
    pub entry: HistoryEntry,
    pub events: Vec<HistoryEvent>,
    pub next: Option<usize>,
}
#[derive(Serialize, Deserialize)]
pub struct HistoryBundle {
    pub entry: HistoryEntry,
    pub transcript_path: String,
    pub raw_path: String,
}
