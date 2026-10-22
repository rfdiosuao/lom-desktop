use crate::sidecar::{self, Endpoint};
use serde::Serialize;
use std::process::{Child, ExitStatus};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Restart delays for consecutive failures. The last value is the steady-state cap.
const RETRY_DELAYS_MS: [u64; 5] = [500, 2_000, 5_000, 10_000, 30_000];
/// A core that stayed up this long resets the crash counter.
const STABLE_RUN: Duration = Duration::from_secs(60);
const START_TIMEOUT: Duration = Duration::from_secs(45);
const RESTART_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub state: String,
    pub attempt: u32,
    pub last_error: Option<String>,
    pub endpoint: Option<Endpoint>,
    pub log_dir: Option<String>,
}

struct Status {
    state: String,
    attempt: u32,
    last_error: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            state: "starting".to_owned(),
            attempt: 0,
            last_error: None,
        }
    }
}

/// Owns the core child process for the lifetime of the shell.
///
/// The supervisor is the only writer of `endpoint`: it starts the child, watches
/// `try_wait`, and restarts it with a bounded backoff after an unexpected exit.
/// Commands never spawn a second core; they request a restart and wait for a new
/// endpoint generation. This keeps concurrent callers from racing two children.
#[derive(Default)]
pub struct Runtime {
    endpoint: Mutex<Option<Endpoint>>,
    status: Mutex<Status>,
    changed: Condvar,
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
    restart_epoch: AtomicU64,
    generation: AtomicU64,
    fatal: AtomicBool,
    wake: Mutex<u64>,
    wake_cv: Condvar,
    restart_lock: Mutex<()>,
    log_dir: Mutex<Option<String>>,
}

#[tauri::command]
pub async fn core_endpoint(state: tauri::State<'_, Arc<Runtime>>) -> Result<Endpoint, String> {
    let runtime = (*state).clone();
    tauri::async_runtime::spawn_blocking(move || runtime.ensure_blocking())
        .await
        .map_err(|_| "core.join_failed".to_owned())?
}

#[tauri::command]
pub async fn restart_core(state: tauri::State<'_, Arc<Runtime>>) -> Result<Endpoint, String> {
    let runtime = (*state).clone();
    tauri::async_runtime::spawn_blocking(move || runtime.restart_blocking())
        .await
        .map_err(|_| "core.join_failed".to_owned())?
}

#[tauri::command]
pub fn core_status(state: tauri::State<'_, Arc<Runtime>>) -> CoreStatus {
    state.snapshot()
}

pub fn start(app: AppHandle, state: Arc<Runtime>) {
    std::thread::spawn(move || state.supervise(app));
}

impl Runtime {
    fn supervise(&self, app: AppHandle) {
        let data = match app.path().app_data_dir() {
            Ok(path) => path,
            Err(error) => {
                self.fatal.store(true, Ordering::SeqCst);
                self.set_status("unavailable", 0, Some(format!("core.no_data_dir: {error}")));
                self.emit_status(&app);
                return;
            }
        };
        if let Ok(mut slot) = self.log_dir.lock() {
            *slot = Some(data.join("logs").to_string_lossy().into_owned());
        }

        let mut attempt = 0u32;
        loop {
            if self.stopping.load(Ordering::SeqCst) {
                break;
            }
            let _ = sidecar::stop_child(&self.child);
            self.fatal.store(false, Ordering::SeqCst);
            self.set_status("starting", attempt, self.last_error());
            self.emit_status(&app);

            let epoch = self.restart_epoch.load(Ordering::SeqCst);
            let started_at = Instant::now();
            match sidecar::start(&data, &self.child, &self.stopping) {
                Ok(endpoint) => {
                    if self.stopping.load(Ordering::SeqCst) {
                        let _ = sidecar::stop_child(&self.child);
                        break;
                    }
                    if self.restart_epoch.load(Ordering::SeqCst) != epoch {
                        let _ = sidecar::stop_child(&self.child);
                        continue;
                    }

                    self.fatal.store(false, Ordering::SeqCst);
                    if let Ok(mut slot) = self.endpoint.lock() {
                        *slot = Some(endpoint.clone());
                        self.generation.fetch_add(1, Ordering::SeqCst);
                        self.changed.notify_all();
                    }
                    self.set_status("ready", 0, None);
                    let _ = app.emit("core://endpoint", endpoint);
                    self.emit_status(&app);

                    let mut explicit_restart = false;
                    loop {
                        if self.stopping.load(Ordering::SeqCst) {
                            let _ = sidecar::stop_child(&self.child);
                            break;
                        }
                        if self.restart_epoch.load(Ordering::SeqCst) != epoch {
                            let _ = sidecar::stop_child(&self.child);
                            explicit_restart = true;
                            break;
                        }
                        let exit = match self.child.lock() {
                            Ok(mut child) => child.as_mut().map(|child| child.try_wait()),
                            Err(_) => None,
                        };
                        match exit {
                            None => {
                                self.set_status(
                                    "restarting",
                                    attempt + 1,
                                    Some("core.child_missing".to_owned()),
                                );
                                break;
                            }
                            Some(Ok(None)) => {}
                            Some(Ok(Some(status))) => {
                                self.set_status(
                                    "restarting",
                                    attempt + 1,
                                    Some(format!("core.exited: {status}")),
                                );
                                break;
                            }
                            Some(Err(error)) => {
                                self.set_status(
                                    "restarting",
                                    attempt + 1,
                                    Some(format!("core.wait_failed: {error}")),
                                );
                                break;
                            }
                        }
                        self.sleep(Duration::from_millis(500), epoch);
                    }

                    if self.stopping.load(Ordering::SeqCst) {
                        let _ = sidecar::stop_child(&self.child);
                        break;
                    }
                    if explicit_restart {
                        attempt = 0;
                        continue;
                    }
                    self.emit_status(&app);
                    attempt = if started_at.elapsed() >= STABLE_RUN {
                        1
                    } else {
                        attempt + 1
                    };
                    self.sleep(backoff_delay(attempt), epoch);
                }
                Err(error) => {
                    let fatal = matches!(
                        error.code,
                        "core.not_configured"
                            | "core.invalid_binary"
                            | "core.no_data_dir"
                            | "core.no_home"
                    );
                    self.fatal.store(fatal, Ordering::SeqCst);
                    self.set_status(
                        if fatal { "unavailable" } else { "failed" },
                        attempt + 1,
                        Some(error.to_string()),
                    );
                    self.emit_status(&app);
                    if fatal {
                        // Keep the epoch from before start: a retry arriving
                        // while start fails must not be swallowed by the wait.
                        self.wait_for_restart(epoch);
                        if self.stopping.load(Ordering::SeqCst) {
                            break;
                        }
                        attempt = 0;
                        continue;
                    }
                    attempt += 1;
                    self.sleep(backoff_delay(attempt), epoch);
                }
            }
        }
        self.set_status("stopped", attempt, self.last_error());
        self.emit_status(&app);
    }

    /// Return a live endpoint, waiting for an in-flight start and recovering once
    /// from a stale endpoint. It deliberately does not spawn a second child.
    fn ensure_blocking(&self) -> Result<Endpoint, String> {
        let deadline = Instant::now() + START_TIMEOUT;
        let mut requested = false;
        loop {
            if self.stopping.load(Ordering::SeqCst) {
                return Err("core.stopped".to_owned());
            }
            if self.fatal.load(Ordering::SeqCst) {
                return Err(self
                    .last_error()
                    .unwrap_or_else(|| "core.unavailable".to_owned()));
            }
            if let Some(endpoint) = self.current_endpoint() {
                let ready = self.state() == "ready";
                if ready && endpoint.port().is_some_and(sidecar::healthy) {
                    return Ok(endpoint);
                }
                if ready && !requested {
                    self.request_restart();
                    requested = true;
                }
            }
            if Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err(self
            .last_error()
            .unwrap_or_else(|| "core.start_timeout".to_owned()))
    }

    pub(crate) fn restart_blocking(&self) -> Result<Endpoint, String> {
        let _guard = self
            .restart_lock
            .lock()
            .map_err(|_| "core.state_poisoned".to_owned())?;
        let generation = self.generation.load(Ordering::SeqCst);
        self.request_restart();
        self.wait_for_generation(generation, RESTART_TIMEOUT)
    }

    fn wait_for_generation(&self, after: u64, timeout: Duration) -> Result<Endpoint, String> {
        let deadline = Instant::now() + timeout;
        let mut slot = self
            .endpoint
            .lock()
            .map_err(|_| "core.state_poisoned".to_owned())?;
        loop {
            if self.stopping.load(Ordering::SeqCst) {
                return Err("core.stopped".to_owned());
            }
            if self.fatal.load(Ordering::SeqCst) {
                return Err(self
                    .last_error()
                    .unwrap_or_else(|| "core.unavailable".to_owned()));
            }
            if self.generation.load(Ordering::SeqCst) > after {
                if let Some(endpoint) = slot.as_ref() {
                    if endpoint.port().is_some_and(sidecar::healthy) {
                        return Ok(endpoint.clone());
                    }
                }
            }
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let (next, _) = self
                .changed
                .wait_timeout(slot, deadline - now)
                .map_err(|_| "core.state_poisoned".to_owned())?;
            slot = next;
        }
        Err(self
            .last_error()
            .unwrap_or_else(|| "core.restart_timeout".to_owned()))
    }

    fn request_restart(&self) {
        self.fatal.store(false, Ordering::SeqCst);
        self.restart_epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut wake) = self.wake.lock() {
            *wake = wake.wrapping_add(1);
        }
        self.wake_cv.notify_all();
    }

    fn wait_for_restart(&self, epoch: u64) {
        let Ok(guard) = self.wake.lock() else { return };
        let _guard = self.wake_cv.wait_while(guard, |_| {
            !self.stopping.load(Ordering::SeqCst)
                && self.restart_epoch.load(Ordering::SeqCst) == epoch
        });
    }

    fn sleep(&self, delay: Duration, epoch: u64) {
        let Ok(guard) = self.wake.lock() else {
            std::thread::sleep(delay);
            return;
        };
        let _ = self.wake_cv.wait_timeout_while(guard, delay, |_| {
            !self.stopping.load(Ordering::SeqCst)
                && self.restart_epoch.load(Ordering::SeqCst) == epoch
        });
    }

    fn current_endpoint(&self) -> Option<Endpoint> {
        self.endpoint.lock().ok().and_then(|slot| slot.clone())
    }

    fn state(&self) -> String {
        self.status
            .lock()
            .map(|status| status.state.clone())
            .unwrap_or_default()
    }

    fn last_error(&self) -> Option<String> {
        self.status
            .lock()
            .ok()
            .and_then(|status| status.last_error.clone())
    }

    fn set_status(&self, state: &str, attempt: u32, last_error: Option<String>) {
        if let Ok(mut status) = self.status.lock() {
            status.state = state.to_owned();
            status.attempt = attempt;
            status.last_error = last_error;
        }
        if state != "ready" {
            if let Ok(mut endpoint) = self.endpoint.lock() {
                *endpoint = None;
                self.changed.notify_all();
            }
        }
    }

    fn snapshot(&self) -> CoreStatus {
        let (state, attempt, last_error) = self
            .status
            .lock()
            .map(|status| {
                (
                    status.state.clone(),
                    status.attempt,
                    status.last_error.clone(),
                )
            })
            .unwrap_or_else(|_| ("unknown".to_owned(), 0, None));
        CoreStatus {
            state,
            attempt,
            last_error,
            endpoint: self.current_endpoint(),
            log_dir: self.log_dir.lock().ok().and_then(|slot| slot.clone()),
        }
    }

    fn emit_status(&self, app: &AppHandle) {
        let _ = app.emit("core://status", self.snapshot());
    }

    pub fn shutdown(&self) -> Option<ExitStatus> {
        self.stopping.store(true, Ordering::SeqCst);
        // Synchronize notification with waiters' predicate checks.
        if let Ok(_guard) = self.endpoint.lock() {
            self.changed.notify_all();
        }
        if let Ok(_guard) = self.wake.lock() {
            self.wake_cv.notify_all();
        }
        sidecar::stop_child(&self.child)
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn backoff_delay(attempt: u32) -> Duration {
    let index = attempt
        .saturating_sub(1)
        .min(RETRY_DELAYS_MS.len() as u32 - 1) as usize;
    Duration::from_millis(RETRY_DELAYS_MS[index])
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

    fn verify_shutdown() {
        let state = Runtime::default();
        *state.child.lock().expect("child slot") = Some(sleeping_child());
        let status = state.shutdown().expect("child reaped");
        assert!(
            !status.success(),
            "shutdown must kill the live child, not wait for normal sleep completion"
        );
        assert!(state.child.lock().expect("child slot").is_none());
        assert!(state.shutdown().is_none(), "shutdown must be idempotent");
        assert!(state.stopping.load(Ordering::SeqCst));
    }

    #[test]
    fn shutdown_kills_ready_runtime() {
        verify_shutdown();
    }

    #[test]
    fn shutdown_kills_child_while_waiting_for_health() {
        verify_shutdown();
    }

    #[test]
    fn backoff_delays_grow_then_cap() {
        assert_eq!(backoff_delay(1), Duration::from_millis(500));
        assert_eq!(backoff_delay(2), Duration::from_millis(2_000));
        assert_eq!(backoff_delay(3), Duration::from_millis(5_000));
        assert_eq!(backoff_delay(4), Duration::from_millis(10_000));
        assert_eq!(backoff_delay(5), Duration::from_millis(30_000));
        assert_eq!(backoff_delay(50), Duration::from_millis(30_000));
    }

    #[test]
    fn status_starts_in_starting_state() {
        let status = Runtime::default().snapshot();
        assert_eq!(status.state, "starting");
        assert_eq!(status.attempt, 0);
        assert!(status.endpoint.is_none());
    }

    #[test]
    fn ensure_after_shutdown_returns_stopped_immediately() {
        let runtime = Runtime::default();
        runtime.shutdown();
        assert!(matches!(runtime.ensure_blocking(), Err(error) if error == "core.stopped"));
    }

    #[test]
    fn fatal_start_failure_releases_restart_waiter() {
        let runtime = Runtime::default();
        runtime.fatal.store(true, Ordering::SeqCst);
        runtime.set_status("unavailable", 1, Some("core.invalid_binary".into()));
        let started = Instant::now();
        assert!(
            matches!(runtime.wait_for_generation(0, Duration::from_secs(2)), Err(error) if error == "core.invalid_binary")
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn restart_requested_during_failed_start_is_not_lost() {
        let runtime = Arc::new(Runtime::default());
        let start_epoch = runtime.restart_epoch.load(Ordering::SeqCst);
        runtime.request_restart();
        let (send, receive) = std::sync::mpsc::channel();
        let waiting = runtime.clone();
        let thread = std::thread::spawn(move || {
            waiting.wait_for_restart(start_epoch);
            send.send(()).unwrap();
        });
        let completed = receive.recv_timeout(Duration::from_secs(1)).is_ok();
        runtime.shutdown();
        thread.join().unwrap();
        assert!(
            completed,
            "a restart received before waiting must still wake the supervisor"
        );
    }

    #[test]
    fn retry_backoff_observes_restart_before_waiting() {
        let runtime = Runtime::default();
        let epoch = runtime.restart_epoch.load(Ordering::SeqCst);
        runtime.request_restart();
        let started = Instant::now();
        runtime.sleep(Duration::from_secs(2), epoch);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn failed_runtime_does_not_advertise_an_old_endpoint() {
        let runtime = Runtime::default();
        *runtime.endpoint.lock().unwrap() = Some(Endpoint {
            url: "http://127.0.0.1:31415".into(),
            token: "test".into(),
            default_folder: String::new(),
            home_dir: String::new(),
        });
        runtime.set_status("restarting", 1, Some("core.exited".into()));
        assert!(runtime.snapshot().endpoint.is_none());
    }
}
