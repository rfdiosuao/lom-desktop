use super::*;
/// 主人记录可能不存在（FEISHU-06 之前两次扫码接入）：交给授权核实后补记
pub(super) fn prepare(
    start_dir: &Path,
) -> Result<(String, Option<String>, String, String), String> {
    let status = status_json(start_dir)?;
    let app_id = parse_status(&status)
        .app_id
        .ok_or("feishu.not_configured")?;
    let owner = crate::feishu_register::read_owner(start_dir);
    let out = command(
        start_dir,
        &["auth", "login", "--recommend", "--no-wait", "--json"],
    )?
    .output()
    .map_err(|_| "feishu.authorize_failed".to_owned())?;
    let (url, code) = parse_login_start(&String::from_utf8_lossy(&out.stdout))
        .ok_or("feishu.authorize_failed: 未获得授权链接")?;
    Ok::<_, String>((app_id, owner, url, code))
}
pub(super) fn poll(dir: &Path, code: &str) -> Result<(Child, mpsc::Receiver<String>), String> {
    let mut child = command(
        dir,
        &[
            "auth",
            "login",
            "--recommend",
            "--device-code",
            code,
            "--json",
        ],
    )?
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|_| "feishu.authorize_failed".to_owned())?;
    let (tx, rx) = mpsc::sync_channel::<String>(32);
    if let Some(err) = child.stderr.take() {
        pump(err, tx.clone());
    }
    if let Some(out) = child.stdout.take() {
        pump(out, tx.clone());
    }
    drop(tx);

    Ok((child, rx))
}
