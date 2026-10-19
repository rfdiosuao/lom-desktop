use crate::sidecar::{self, Endpoint};
use std::process::Child;
use std::sync::{Arc, Condvar, Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct Runtime {
    result: Mutex<Option<Result<Endpoint, String>>>,
    ready: Condvar,
    child: Mutex<Option<Child>>,
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
                let mut sidecar = sidecar::start(&path).map_err(|e| e.to_string())?;
                match state.child.lock() {
                    Ok(mut child) => *child = Some(sidecar.child),
                    Err(_) => {
                        let _ = sidecar.child.kill();
                        let _ = sidecar.child.wait();
                        return Err("core.state_poisoned".into());
                    }
                }
                Ok(sidecar.endpoint)
            });
        if let Ok(mut result) = state.result.lock() {
            *result = Some(outcome);
        }
        state.ready.notify_all();
    });
}

impl Drop for Runtime {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
