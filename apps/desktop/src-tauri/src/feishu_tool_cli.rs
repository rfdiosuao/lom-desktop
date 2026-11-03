use super::*;
pub(super) fn classify_error(raw: &str) -> String {
    let text = raw.to_ascii_lowercase();
    if [
        "unauthorized",
        "token expired",
        "99991663",
        "need_user_auth",
        "not logged in",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        "feishu.need_user_auth".into()
    } else if ["scope", "permission", "99991672"]
        .iter()
        .any(|s| text.contains(s))
    {
        "feishu.scope_missing".into()
    } else {
        "feishu.tool_failed".into()
    }
}
pub(super) fn run_cli(dir: &Path, args: &[String]) -> Result<String, String> {
    run_at(dir, args, None)
}
pub(super) fn run_at(dir: &Path, args: &[String], cwd: Option<&Path>) -> Result<String, String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut command = crate::feishu::command(dir, &refs)?;
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "feishu.tool_failed".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "feishu.tool_failed".to_owned())?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(RAW_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("feishu.tool_failed: timeout".into());
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "feishu.tool_failed".to_owned())?
        .map_err(|_| "feishu.tool_failed".to_owned())?;
    if bytes.len() as u64 > RAW_LIMIT {
        return Err("feishu.output_too_large".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "feishu.tool_failed".to_owned())?;
    if !status.success() {
        return Err(classify_error(&text));
    }
    Ok(text)
}
