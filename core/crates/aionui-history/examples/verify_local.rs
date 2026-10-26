//! Explicit local-only smoke check. Prints counts, never titles/paths/content.
use aionui_api_types::history_import::HistorySource;
use aionui_history::HistoryStore;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::args().nth(1).ok_or("home argument required")?;
    let destination = std::env::args().nth(2).ok_or("temporary archive argument required")?;
    let started = std::time::Instant::now();
    let store = HistoryStore::new(home.into(), destination.into());
    let scan = store.scan(&[HistorySource::Codex, HistorySource::Claude])?;
    let mut selected = Vec::new();
    for source in [HistorySource::Codex, HistorySource::Claude] {
        if let Some(entry) = scan
            .entries
            .iter()
            .filter(|e| e.source == source && e.events > 5)
            .min_by_key(|e| e.bytes)
        {
            selected.push(entry.clone());
        }
    }
    let first = store.import(&selected)?;
    let repeat = store.import(&selected)?;
    let rescan = store.scan(&[HistorySource::Codex, HistorySource::Claude])?;
    assert!(
        selected
            .iter()
            .all(|e| rescan.entries.iter().any(|v| v.id == e.id && v.digest == e.digest))
    );
    assert_eq!(first.imported, selected.len());
    assert_eq!(repeat.skipped, selected.len());
    for entry in &selected {
        let page = store.page(&entry.id, 0)?;
        assert!(!page.events.is_empty());
        store.bundle(&entry.id)?;
    }
    println!(
        "discovered={} diagnostics={} selected={} imported={} duplicate_skipped={} unchanged_sources=true elapsed_ms={}",
        scan.entries.len(),
        scan.diagnostics.len(),
        selected.len(),
        first.imported,
        repeat.skipped,
        started.elapsed().as_millis()
    );
    Ok(())
}
