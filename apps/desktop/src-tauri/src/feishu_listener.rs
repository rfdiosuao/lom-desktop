//! Scoped listener process ownership and redacted lifecycle notifications.
use super::*;
use std::collections::{HashSet, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::ChildStdout;

pub(super) fn start(
    app: AppHandle,
    slot: Arc<crate::feishu::ConnectionState>,
    scope: ListenEnded,
    owner: String,
    dir: &Path,
) -> Result<u64, String> {
    let mut child = command(
        dir,
        &["event", "consume", "im.message.receive_v1", "--as", "bot"],
    )?
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("feishu.run_failed: {e}"))?;
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("feishu.run_failed: pipes unavailable".into());
    };
    let pid = child.id();
    match slot.4 .0.lock() {
        Ok(mut guard) => *guard = Some((child, stdin)),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("feishu.state_failed".into());
        }
    }
    // Drain stderr without retaining CLI output, which may contain credentials or private text.
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if line.is_err() {
                log::warn!("feishu.listener_stderr_failed");
                break;
            }
        }
    });
    let generation = scope.generation;
    std::thread::spawn(move || forward(app, slot, scope, owner, stdout, pid));
    Ok(generation)
}

fn forward(
    app: AppHandle,
    slot: Arc<crate::feishu::ConnectionState>,
    scope: ListenEnded,
    owner: String,
    stdout: ChildStdout,
    pid: u32,
) {
    let mut seen = HashSet::new();
    let mut order = VecDeque::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Some(msg) = inbound(&line, &owner) else {
            continue;
        };
        if crate::feishu_scope::generation(&slot) != scope.generation {
            break;
        }
        let msg = msg.scoped(
            &scope.account,
            &scope.assistant_id,
            &scope.app_id,
            scope.generation,
        );
        // Reconnects can redeliver: retain only the most recent 500 message identifiers.
        if !seen.insert(msg.message_id.clone()) {
            continue;
        }
        order.push_back(msg.message_id.clone());
        if order.len() > 500 {
            if let Some(old) = order.pop_front() {
                seen.remove(&old);
            }
        }
        if app.emit("feishu-message", msg).is_err() {
            log::warn!("feishu.window_notify_failed");
        }
    }
    ended(&app, &slot, scope, pid);
}

fn ended(app: &AppHandle, slot: &crate::feishu::ConnectionState, mut scope: ListenEnded, pid: u32) {
    let Ok(_lifecycle) = slot.6.lock() else {
        log::error!("feishu.state_failed");
        return;
    };
    let current = slot
        .4
         .0
        .lock()
        .map(|g| g.as_ref().is_some_and(|(c, _)| c.id() == pid))
        .unwrap_or(false);
    if !current {
        return;
    }
    crate::feishu_scope::invalidate(slot);
    stop(&slot.4);
    scope.error = Some("feishu.listener_ended".to_owned());
    if app.emit("feishu-listen-ended", scope).is_err() {
        log::warn!("feishu.window_notify_failed");
    }
}
