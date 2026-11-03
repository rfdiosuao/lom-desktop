fn main() {
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest
        .ancestors()
        .nth(3)
        .expect("desktop repository root");
    let target = std::env::var("TARGET").expect("Cargo target");
    let binary = manifest.join("binaries").join(format!(
        "aioncore-{target}{}",
        if target.contains("windows") {
            ".exe"
        } else {
            ""
        }
    ));
    for path in [
        root.join("tools/verify-core-input.py"),
        root.join("packaging/core-requirements.json"),
        root.join("packaging/mac-core.json"),
        root.join("packaging/windows-core.json"),
        root.join("apps/desktop/package.json"),
        binary.clone(),
    ] {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    // Commercial builds verify a pinned core manifest. The community snapshot builds the
    // local core from `core/` and may not carry those private manifests, so only run the
    // verifier when the complete commercial review input is present.
    let verifier = root.join("tools/verify-core-input.py");
    let manifests = [
        root.join("packaging/core-requirements.json"),
        root.join("packaging/mac-core.json"),
        root.join("packaging/windows-core.json"),
    ];
    if std::env::var("PROFILE").as_deref() == Ok("release")
        && verifier.is_file()
        && manifests.iter().all(|p| p.is_file())
    {
        let status = std::process::Command::new(if cfg!(windows) { "python" } else { "python3" })
            .arg(verifier)
            .arg("--root")
            .arg(root)
            .arg("--target")
            .arg(&target)
            .arg("--binary")
            .arg(&binary)
            .status()
            .expect("Python 3 is required to verify release core inputs");
        assert!(status.success(), "Release core input verification failed");
    }
    tauri_build::build()
}
