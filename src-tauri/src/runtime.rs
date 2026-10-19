use crate::sidecar::{self, Endpoint};
use std::process::{Child, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct Runtime {
    result: Mutex<Option<Result<Endpoint, String>>>,
    ready: Condvar,
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
}

#[tauri::command]
pub async fn core_endpoint(state: tauri::State<'_, Arc<Runtime>>) -> Result<Endpoint, String> {
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state.result.lock().map_err(|_| "core.state_poisoned")?;
        while guard.is_none() {
            guard = state.ready.wait(guard).map_err(|_| "core.state_poisoned")?;
        }
        guard
            .clone()
            .unwrap_or_else(|| Err("core.state_missing".into()))
    })
    .await
    .map_err(|_| "core.join_failed".to_owned())?
}

pub fn start(app: &tauri::AppHandle, state: Arc<Runtime>) {
    let data = app.path().app_data_dir();
    std::thread::spawn(move || {
        let outcome = data
            .map_err(|_| "core.no_data_dir".to_owned())
            .and_then(|path| {
                sidecar::start(&path, &state.child, &state.stopping).map_err(|e| e.to_string())
            });
        if outcome.is_err() {
            let _ = sidecar::stop_child(&state.child);
        }
        if let Ok(mut result) = state.result.lock() {
            *result = Some(outcome);
        }
        state.ready.notify_all();
    });
}

impl Runtime {
    pub fn shutdown(&self) -> Option<ExitStatus> {
        self.stopping.store(true, Ordering::SeqCst);
        sidecar::stop_child(&self.child)
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn sleeping_child() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut cmd = Command::new("powershell.exe");
            cmd.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 2",
            ]);
            cmd
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut cmd = Command::new("/bin/sleep");
            cmd.arg("2");
            cmd
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("test child")
    }

    fn verify_shutdown(ready: bool) {
        let state = Runtime::default();
        if ready {
            *state.result.lock().expect("result") = Some(Ok(Endpoint {
                url: "http://127.0.0.1:31415".into(),
                token: String::new(),
                default_folder: String::new(),
                home_dir: String::new(),
            }));
        }
        *state.child.lock().expect("slot") = Some(sleeping_child());
        let status = state.shutdown().expect("child reaped");
        assert!(
            !status.success(),
            "shutdown must kill the live child, not wait for normal sleep completion"
        );
        assert!(state.child.lock().expect("slot").is_none());
        assert!(state.shutdown().is_none(), "shutdown must be idempotent");
        assert!(state.stopping.load(Ordering::SeqCst));
    }

    #[test]
    fn shutdown_kills_ready_runtime() {
        verify_shutdown(true);
    }
    #[test]
    fn shutdown_kills_child_while_waiting_for_health() {
        verify_shutdown(false);
    }
}
