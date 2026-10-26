use super::*;
use aionui_api_types::history_import::HistorySource;
use std::fs;
fn fixture() -> (tempfile::TempDir, HistoryStore) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("home/.codex/sessions")).unwrap();
    let store = HistoryStore::new(dir.path().join("home"), dir.path().join("archive"));
    (dir, store)
}
const CODEX: &str = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"c1\",\"cwd\":\"/中文\"}}\n{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"继续项目\"}]}}\n{\"type\":\"response_item\",\"payload\":{\"type\":\"function_call\",\"arguments\":\"{}\"}}\n";
#[test]
fn hist01_snapshot_dedup_restart_and_source_independence() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/a.jsonl");
    fs::write(&path, CODEX).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    assert_eq!(scan.entries.len(), 1);
    assert_eq!(scan.entries[0].title, "继续项目");
    assert_eq!(scan.entries[0].events, 3);
    assert_eq!(store.import(&scan.entries).unwrap().imported, 1);
    assert_eq!(store.import(&scan.entries).unwrap().skipped, 1);
    assert_eq!(fs::read_to_string(&path).unwrap(), CODEX);
    fs::remove_file(path).unwrap();
    let restarted = HistoryStore::new(dir.path().join("empty"), dir.path().join("archive"));
    assert_eq!(restarted.list().unwrap().entries.len(), 1);
    let page = restarted.page(&scan.entries[0].id, 0).unwrap();
    assert!(page.events.iter().any(|e| e.text.contains("继续项目")));
    assert!(page.events.iter().any(|e| e.kind == "response_item:function_call"));
}
#[test]
fn hist01_changed_source_rejects_preview_and_invalid_id_cannot_traverse() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/a.jsonl");
    fs::write(&path, CODEX).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    fs::write(path, format!("{CODEX}{{}}\n")).unwrap();
    assert_eq!(store.import(&scan.entries).unwrap().imported, 0);
    assert!(store.page("../escape", 0).is_err());
}
#[test]
fn hist01_claude_and_corrupt_lines_are_reported_not_hidden() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.claude/projects/p");
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join("a.jsonl"), "{\"type\":\"user\",\"sessionId\":\"s1\",\"message\":{\"role\":\"user\",\"content\":\"你好\"}}\nBROKEN\n{\"type\":\"assistant\",\"sessionId\":\"s1\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"思考\"},{\"type\":\"text\",\"text\":\"完成\"}]}}\n").unwrap();
    let scan = store.scan(&[HistorySource::Claude]).unwrap();
    assert_eq!(scan.entries[0].title, "你好");
    assert!(scan.entries[0].warnings.iter().any(|s| s.contains("malformed")));
    assert_eq!(store.import(&scan.entries).unwrap().imported, 1);
    let page = store.page(&scan.entries[0].id, 0).unwrap();
    assert!(page.events.iter().any(|e| e.text.contains("思考")));
}

#[test]
fn hist01_bundle_contains_real_transcript_and_raw_without_model_calls() {
    let (dir, store) = fixture();
    fs::write(dir.path().join("home/.codex/sessions/a.jsonl"), CODEX).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    store.import(&scan.entries).unwrap();
    let bundle = store.bundle(&scan.entries[0].id).unwrap();
    assert!(fs::read_to_string(bundle.transcript_path).unwrap().contains("继续项目"));
    assert_eq!(fs::read_to_string(bundle.raw_path).unwrap(), CODEX);
}
#[cfg(unix)]
#[test]
fn hist01_symlink_sources_are_not_followed() {
    let (dir, store) = fixture();
    let outside = dir.path().join("outside.jsonl");
    fs::write(&outside, CODEX).unwrap();
    std::os::unix::fs::symlink(outside, dir.path().join("home/.codex/sessions/link.jsonl")).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    assert!(scan.entries.is_empty());
    assert!(scan.diagnostics.iter().any(|v| v == "symlink_skipped"));
}

#[test]
fn hist01_incremental_changes_preserve_both_versions() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/a.jsonl");
    fs::write(&path, CODEX).unwrap();
    let original = store.scan(&[HistorySource::Codex]).unwrap();
    store.import(&original.entries).unwrap();
    fs::write(
        &path,
        format!("{CODEX}{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\"}}}}\n"),
    )
    .unwrap();
    let changed = store.scan(&[HistorySource::Codex]).unwrap();
    assert_ne!(original.entries[0].id, changed.entries[0].id);
    assert_eq!(store.import(&changed.entries).unwrap().imported, 1);
    assert_eq!(store.list().unwrap().entries.len(), 2);
    assert_eq!(
        store.page(&original.entries[0].id, 0).unwrap().entry.digest,
        original.entries[0].digest
    );
}
#[test]
fn hist01_corruption_never_reports_duplicate_success_and_oversize_is_explicit() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/a.jsonl");
    fs::write(&path, CODEX).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    store.import(&scan.entries).unwrap();
    fs::write(
        dir.path().join("archive").join(format!("{}.jsonl", scan.entries[0].id)),
        "broken",
    )
    .unwrap();
    let result = store.import(&scan.entries).unwrap();
    assert_eq!(result.skipped, 0);
    assert!(!result.errors.is_empty());
    let large = fs::File::create(dir.path().join("home/.codex/sessions/large.jsonl")).unwrap();
    large.set_len(2 * 1024 * 1024 * 1024 + 1).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    assert!(scan.diagnostics.iter().any(|e| e.contains("file_too_large")));
}

#[test]
fn hist01_captured_native_samples_produce_readable_both_roles() {
    for (source, raw) in [
        (
            HistorySource::Codex,
            include_bytes!("../tests/fixtures/codex-captured.jsonl").as_slice(),
        ),
        (
            HistorySource::Claude,
            include_bytes!("../tests/fixtures/claude-captured.jsonl").as_slice(),
        ),
    ] {
        let mut events = Vec::new();
        let entry = crate::parser::parse_reader(std::io::Cursor::new(raw), source, |event| {
            events.push(event);
            Ok(())
        })
        .unwrap();
        assert!(!entry.session_id.is_empty());
        assert!(events.iter().any(|e| e.role == "user"));
        assert!(events.iter().any(|e| e.role == "assistant"));
    }
}
#[test]
fn hist01_archive_listing_counts_manifests_not_transcripts_or_temp_files() {
    let (dir, store) = fixture();
    let archive = dir.path().join("archive");
    fs::create_dir_all(&archive).unwrap();
    for n in 0..10_000 {
        fs::write(archive.join(format!("junk{n}.part")), "").unwrap();
    }
    fs::write(dir.path().join("home/.codex/sessions/a.jsonl"), CODEX).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    store.import(&scan.entries).unwrap();
    assert_eq!(store.list().unwrap().entries.len(), 1);
}
#[test]
fn hist01_streams_over_64mb_and_keeps_records_after_a_large_line() {
    use std::io::Write;
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/large.jsonl");
    let mut f = fs::File::create(&path).unwrap();
    f.write_all(CODEX.as_bytes()).unwrap();
    let chunk = [b'x'; 65536];
    for _ in 0..1040 {
        f.write_all(&chunk).unwrap();
    }
    f.write_all(b"\n{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"after large line\"}]}}\n").unwrap();
    drop(f);
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    assert!(scan.entries[0].bytes > 64 * 1024 * 1024);
    assert!(
        scan.entries[0]
            .warnings
            .iter()
            .any(|v| v == "large_lines_raw_preserved")
    );
    assert_eq!(store.import(&scan.entries).unwrap().imported, 1);
    assert!(
        store
            .page(&scan.entries[0].id, 0)
            .unwrap()
            .events
            .iter()
            .any(|e| e.text == "after large line")
    );
    let bundle = store.bundle(&scan.entries[0].id).unwrap();
    assert_eq!(
        fs::metadata(bundle.raw_path).unwrap().len(),
        fs::metadata(path).unwrap().len()
    );
}

#[cfg(unix)]
#[test]
fn hist01_existing_destination_symlink_is_never_reported_as_an_archive() {
    let (dir, store) = fixture();
    let source = dir.path().join("home/.codex/sessions/a.jsonl");
    fs::write(&source, CODEX).unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    fs::create_dir_all(dir.path().join("archive")).unwrap();
    std::os::unix::fs::symlink(
        source,
        dir.path().join("archive").join(format!("{}.jsonl", scan.entries[0].id)),
    )
    .unwrap();
    let result = store.import(&scan.entries).unwrap();
    assert_eq!(result.imported, 0);
    assert!(!result.errors.is_empty());
    assert!(store.list().unwrap().entries.is_empty());
}
#[test]
fn hist01_forging_new_digest_cannot_replace_an_old_preview_identity() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/a.jsonl");
    fs::write(&path, CODEX).unwrap();
    let mut old = store.scan(&[HistorySource::Codex]).unwrap();
    let changed = format!("{CODEX}{{}}\n");
    fs::write(path, &changed).unwrap();
    old.entries[0].digest = crate::parser::digest(changed.as_bytes());
    let result = store.import(&old.entries).unwrap();
    assert_eq!(result.imported, 0);
    assert!(!result.errors.is_empty());
}

#[test]
fn hist02_uses_codex_native_title_and_ignores_injected_setup_messages() {
    let (dir, store) = fixture();
    let path = dir.path().join("home/.codex/sessions/a.jsonl");
    let noise = "{\"type\":\"response_item\",\"payload\":{\"role\":\"user\",\"content\":[{\"text\":\"<environment_context><cwd>/private/path</cwd></environment_context>\"}]}}\n";
    fs::write(path, format!("{noise}{CODEX}")).unwrap();
    fs::write(
        dir.path().join("home/.codex/session_index.jsonl"),
        "{\"id\":\"c1\",\"thread_name\":\"真正的项目标题\"}\n",
    )
    .unwrap();
    let scan = store.scan(&[HistorySource::Codex]).unwrap();
    assert_eq!(scan.entries[0].title, "真正的项目标题");
    store.import(&scan.entries).unwrap();
    assert_eq!(store.list().unwrap().entries[0].title, "真正的项目标题");
}

#[test]
fn hist02_skips_environment_as_title_and_respects_claude_custom_title() {
    assert!(crate::titles::clean_title("<environment_context>setup</environment_context>").is_none());
    assert!(crate::titles::clean_title("# AGENTS.md instructions for /private").is_none());
    let input = b"{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"first question\"}}\n{\"type\":\"custom-title\",\"customTitle\":\"My original title\"}\n";
    let entry = crate::parser::parse_reader(&input[..], HistorySource::Claude, |_| Ok(())).unwrap();
    assert_eq!(entry.title, "My original title");
}
