//! FEISHU-MULTI: tuple-scoped process state and connection receipts.
use crate::feishu::ConnectionState;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
#[derive(Default)]
pub struct FeishuState {
    slots: Mutex<HashMap<(String, String), Arc<ConnectionState>>>,
    apps: Mutex<HashMap<(String, String), String>>,
}
impl FeishuState {
    pub(crate) fn scoped(
        &self,
        account: &str,
        assistant: &str,
    ) -> Result<Arc<ConnectionState>, String> {
        crate::feishu_paths::validate_scope(account, assistant)?;
        let mut slots = self.slots.lock().map_err(|_| "feishu.state_failed")?;
        Ok(slots
            .entry((account.into(), assistant.into()))
            .or_default()
            .clone())
    }
    pub(crate) fn claim(&self, account: &str, assistant: &str, app: &str) -> Result<(), String> {
        let mut apps = self.apps.lock().map_err(|_| "feishu.state_failed")?;
        let key = (account.into(), app.into());
        if apps.get(&key).is_some_and(|a| a != assistant) {
            return Err("feishu.binding_owned".into());
        }
        apps.insert(key, assistant.into());
        Ok(())
    }
    pub(crate) fn account_slots(&self, account: &str) -> Vec<Arc<ConnectionState>> {
        self.slots
            .lock()
            .map(|s| {
                s.iter()
                    .filter(|((a, _), _)| a == account)
                    .map(|(_, v)| v.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
}
pub(crate) fn generation(state: &ConnectionState) -> u64 {
    state.3.load(Ordering::SeqCst)
}
pub(crate) fn invalidate(state: &ConnectionState) {
    state.3.fetch_add(1, Ordering::SeqCst);
}
pub(crate) fn check_generation(state: &ConnectionState, expected: u64) -> Result<(), String> {
    if generation(state) == expected {
        Ok(())
    } else {
        Err("feishu.binding_changed".into())
    }
}
pub(crate) fn with_generation<T>(
    state: &ConnectionState,
    expected: u64,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lifecycle = state.6.lock().map_err(|_| "feishu.state_failed")?;
    check_generation(state, expected)?;
    let result = operation()?;
    check_generation(state, expected)?;
    Ok(result)
}
pub(crate) fn receipt(
    app: &tauri::AppHandle,
    account: &str,
    assistant: &str,
    app_id: &str,
    epoch: u64,
) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let registry = app.state::<Arc<FeishuState>>();
    let slot = registry.scoped(account, assistant)?;
    if generation(&slot) != epoch {
        return Err("feishu.binding_changed".into());
    }
    let dir = crate::feishu_paths::scoped_config_dir(app, account, assistant)?;
    let out = crate::feishu::command(&dir, &["auth", "status", "--json"])?
        .output()
        .map_err(|_| "feishu.status_failed")?;
    if !out.status.success()
        || crate::feishu::parse_status(&String::from_utf8_lossy(&out.stdout))
            .app_id
            .as_deref()
            != Some(app_id)
    {
        return Err("feishu.binding_changed".into());
    }
    if generation(&slot) != epoch {
        return Err("feishu.binding_changed".into());
    }
    crate::feishu_paths::claim_app(app, account, assistant, app_id)?;
    registry.claim(account, assistant, app_id)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_multi_slots_and_cancellation_are_independent() {
        let state = FeishuState::default();
        let a = state.scoped("account", "a").unwrap();
        let b = state.scoped("account", "b").unwrap();
        assert!(!Arc::ptr_eq(&a, &b));
        assert!(Arc::ptr_eq(&a, &state.scoped("account", "a").unwrap()));
        invalidate(&b);
        crate::feishu::replace_child(&b, None);
        assert_eq!(generation(&a), 0);
        assert_eq!(a.1.load(Ordering::SeqCst), 0);
        assert_eq!(generation(&b), 1);
        assert_eq!(b.1.load(Ordering::SeqCst), 1);
        assert!(!Arc::ptr_eq(&a.4, &b.4));
        assert!(!Arc::ptr_eq(&a.5, &b.5));
        assert_eq!(state.account_slots("account").len(), 2);
        assert!(state.account_slots("other").is_empty());
    }
    #[test]
    fn feishu_multi_stop_while_prerequisite_pending_rejects_late_mutation() {
        let slot = Arc::new(ConnectionState::default());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (resume_tx, resume_rx) = std::sync::mpsc::channel();
        let pending = slot.clone();
        let executed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let marker = executed.clone();
        let task = std::thread::spawn(move || {
            let epoch = generation(&pending);
            ready_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            with_generation(&pending, epoch, || {
                marker.store(true, Ordering::SeqCst);
                Ok(())
            })
        });
        ready_rx.recv().unwrap();
        {
            let _lifecycle = slot.6.lock().unwrap();
            invalidate(&slot);
        }
        resume_tx.send(()).unwrap();
        assert_eq!(task.join().unwrap(), Err("feishu.binding_changed".into()));
        assert!(!executed.load(Ordering::SeqCst));
    }

    #[cfg(unix)]
    #[test]
    fn feishu_multi_cancelling_b_reaps_only_b_child() {
        let state = FeishuState::default();
        let a = state.scoped("account", "a").unwrap();
        let b = state.scoped("account", "b").unwrap();
        let child_a = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let child_b = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid_b = child_b.id();
        *a.0.lock().unwrap() = Some(child_a);
        *b.0.lock().unwrap() = Some(child_b);
        crate::feishu::replace_child(&b, None);
        assert!(b.0.lock().unwrap().is_none());
        assert!(a
            .0
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        assert!(!std::process::Command::new("/bin/kill")
            .arg("-0")
            .arg(pid_b.to_string())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
        crate::feishu::replace_child(&a, None);
    }

    #[test]
    fn feishu_multi_same_app_claim_is_idempotent_but_never_shared() {
        let state = FeishuState::default();
        assert!(state.claim("account", "a", "cli_a").is_ok());
        assert!(state.claim("account", "a", "cli_a").is_ok());
        assert_eq!(
            state.claim("account", "b", "cli_a"),
            Err("feishu.binding_owned".into())
        );
        assert!(state.claim("account", "b", "cli_b").is_ok());
    }
}
