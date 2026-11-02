use super::*;
fn root() -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let p = std::env::temp_dir().join(format!(
        "lom-learning-{}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
#[test]
fn pa_evolve_02_compiles_only_closed_preferences_with_real_evidence() {
    let user = "以后回答简短一点";
    let rows = compile(
        r#"[{"slot":"length","value":"concise","quote":"简短一点"}]"#,
        user,
        "",
        "turn:user",
    )
    .unwrap();
    assert_eq!(rows[0].content, "回答优先简洁，保留必要信息。");
    assert!(matches!(rows[0].source, Source::Correction));
}
#[test]
fn pa_evolve_02_replay_does_not_restore_old_preferences() {
    let d = root();
    let short = r#"[{"slot":"length","value":"concise","quote":"简短"}]"#;
    let long = r#"[{"slot":"length","value":"detailed","quote":"详细"}]"#;
    apply(&d, "one", "以后简短", "", "one:u", short).unwrap();
    apply(&d, "two", "以后详细", "", "two:u", long).unwrap();
    let before = std::fs::read_to_string(d.join("USER.md")).unwrap();
    let replay = apply(&d, "one", "以后简短", "", "one:u", short).unwrap();
    assert_eq!(replay.adopted, 0);
    assert_eq!(std::fs::read_to_string(d.join("USER.md")).unwrap(), before);
    std::fs::remove_dir_all(d).unwrap();
}
#[test]
fn pa_evolve_02_reflection_cannot_override_correction_and_manual_notes_survive() {
    let d = root();
    std::fs::write(d.join("USER.md"), "# 手写笔记\n").unwrap();
    apply(
        &d,
        "one",
        "以后简短",
        "",
        "one:u",
        r#"[{"slot":"length","value":"concise","quote":"简短"}]"#,
    )
    .unwrap();
    apply(
        &d,
        "two",
        "写个详细报告",
        "",
        "two:u",
        r#"[{"slot":"length","value":"detailed","quote":"详细报告"}]"#,
    )
    .unwrap();
    let doc = std::fs::read_to_string(d.join("USER.md")).unwrap();
    assert!(doc.starts_with("# 手写笔记\n"));
    assert!(doc.contains("回答优先简洁"));
    assert!(!doc.contains("回答提供充分"));
    std::fs::remove_dir_all(d).unwrap();
}

#[test]
fn pa_evolve_02_invalid_proposals_do_not_touch_the_ledger_or_notes() {
    let d = root();
    std::fs::write(d.join("USER.md"), "original").unwrap();
    assert!(apply(
        &d,
        "bad",
        "hello",
        "",
        "bad:u",
        r#"[{"slot":"permission","value":"all","quote":"hello"}]"#
    )
    .is_err());
    assert!(!d.join(".evolution").exists());
    assert_eq!(
        std::fs::read_to_string(d.join("USER.md")).unwrap(),
        "original"
    );
    std::fs::remove_dir_all(d).unwrap();
}

#[test]
fn pa_evolve_02_workflow_reflection_uses_reply_evidence_and_cannot_inject_instructions() {
    let d = root();
    let rows = r#"[{"slot":"workflow","value":"verify-result","quote":"实际检查通过"}]"#;
    let result = apply(&d, "work", "帮我整理", "实际检查通过", "work:r", rows).unwrap();
    assert!(!result.correction);
    assert!(std::fs::read_to_string(d.join("AGENTS.md"))
        .unwrap()
        .contains("报告完成前核实实际结果"));
    assert!(compile(rows, "帮我整理", "没有这个证据", "work:r").is_err());
    assert!(compile(
        r#"[{"slot":"length","value":"concise","quote":"实际检查通过"}]"#,
        "帮我整理",
        "实际检查通过",
        "work:r"
    )
    .is_err());
    std::fs::remove_dir_all(d).unwrap();
}

#[test]
fn pa_evolve_02_learning_cannot_push_a_document_over_the_context_limit() {
    let d = root();
    let original = "x".repeat(16 * 1024 - 20);
    std::fs::write(d.join("USER.md"), &original).unwrap();
    let result = apply(
        &d,
        "large",
        "以后简短",
        "",
        "large:u",
        r#"[{"slot":"length","value":"concise","quote":"简短"}]"#,
    );
    assert_eq!(result.err().unwrap(), "personal.learning_size");
    assert_eq!(
        std::fs::read_to_string(d.join("USER.md")).unwrap(),
        original
    );
    std::fs::remove_dir_all(d).unwrap();
}

#[test]
fn pa_evolve_02_fenced_json_from_the_model_is_accepted_but_still_checked() {
    let fenced =
        "```json\n[{\"slot\":\"length\",\"value\":\"concise\",\"quote\":\"以后简短一点\"}]\n```";
    assert_eq!(
        compile(fenced, "以后简短一点", "好的", "turn:1")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        compile("```\n[]\n```", "你好", "好的", "turn:1")
            .unwrap()
            .len(),
        0
    );
    let forged =
        "```json\n[{\"slot\":\"length\",\"value\":\"concise\",\"quote\":\"用户没说过\"}]\n```";
    assert!(compile(forged, "以后简短一点", "好的", "turn:1").is_err());
}
