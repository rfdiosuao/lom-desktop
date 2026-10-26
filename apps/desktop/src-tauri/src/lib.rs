//! 麓鸣 Lom 桌面外壳（ADR 0012）：负责窗口与系统对话框，并把 lom-core 作为 sidecar 启动。
//! 前端通过 `core_endpoint` 拿到核心地址与一次性启动令牌，之后直接用 HTTP / WebSocket 访问核心。

mod feishu;
mod feishu_approvals;
mod feishu_gateway;
mod feishu_notice;
mod feishu_paths;
mod feishu_register;
mod feishu_scope;
mod feishu_tools;
mod local_files;
mod login;
mod login_callback;
mod login_target;
mod pairing;
mod personal;
mod personal_evolution;
#[cfg(test)]
#[path = "../../../../tests/security/personal_evolution.rs"]
mod personal_evolution_security;
mod personal_learning;
mod personal_reflection;
mod phone_bridge;
mod preferences;
mod project_links;
mod remote_crypto;
mod reply_images;
mod skill_packages;
// 由 lom-protocol 生成的完整契约；外壳只用到其中的信封类型，其余类型给前端和手机用
#[rustfmt::skip]
#[allow(dead_code)]
mod remote_wire;
mod sidecar;
mod tray;
mod vision;

use std::process::Child;
use std::sync::{Arc, Condvar, Mutex};

use sidecar::Endpoint;
use tauri::{Manager, RunEvent};

/// 核心的启动状态：None = 启动中；Some(Ok) = 就绪；Some(Err) = 失败（带错误码）
#[derive(Default)]
struct CoreState {
    result: Mutex<Option<Result<Endpoint, String>>>,
    ready: Condvar,
    child: Mutex<Option<Child>>,
}

/// 等核心就绪后返回连接信息；失败时返回 `core.<原因>: 详情`
#[tauri::command]
async fn core_endpoint(state: tauri::State<'_, Arc<CoreState>>) -> Result<Endpoint, String> {
    let st = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = st
            .result
            .lock()
            .map_err(|_| "core.state_poisoned".to_owned())?;
        while guard.is_none() {
            guard = st
                .ready
                .wait(guard)
                .map_err(|_| "core.state_poisoned".to_owned())?;
        }
        guard
            .clone()
            .unwrap_or_else(|| Err("core.state_missing".to_owned()))
    })
    .await
    .map_err(|e| format!("core.join_failed: {e}"))?
}

fn start_core(app: &tauri::AppHandle, state: Arc<CoreState>) {
    let data_dir = app.path().app_data_dir();
    std::thread::spawn(move || {
        let outcome = match data_dir {
            Ok(dir) => sidecar::start(&dir)
                .map(|sc| {
                    if let Ok(mut c) = state.child.lock() {
                        *c = Some(sc.child);
                    }
                    sc.endpoint
                })
                .map_err(|e| e.to_string()),
            Err(e) => Err(format!("core.no_data_dir: {e}")),
        };
        if let Err(e) = &outcome {
            log::error!("lom-core failed to start: {e}");
        }
        if let Ok(mut r) = state.result.lock() {
            *r = Some(outcome);
        }
        state.ready.notify_all();
    });
}

fn stop_core(state: &CoreState) {
    if let Ok(mut c) = state.child.lock() {
        if let Some(mut child) = c.take() {
            if let Err(e) = child.kill() {
                log::warn!(
                    "failed to stop lom-core (it exits with the shell via --parent-pid): {e}"
                );
            }
            if let Err(e) = child.wait() {
                log::warn!("failed to reap lom-core: {e}");
            }
        }
    }
}

// The updater calls cleanup_before_exit on Windows before starting NSIS.
// Resource cleanup must release the bundled sidecar executable before replacement.
struct CoreCleanup(Arc<CoreState>);
impl tauri::Resource for CoreCleanup {}
impl Drop for CoreCleanup {
    fn drop(&mut self) {
        stop_core(&self.0);
    }
}

/// 关闭主窗口走外壳 command 而不是渲染进程的 `window.close()`：
/// 权限收窄到单一入口，外壳可以在此记录或拦截退出。
#[tauri::command]
fn close_main_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_owned())?
        .close()
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(CoreState::default());
    let builder = tauri::Builder::default();
    // 单实例必须最先注册：第二次启动时唤回已在运行的窗口（可能正收在托盘里）
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        tray::show_main(app)
    }));
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::clone(&state))
        .manage(Arc::new(phone_bridge::Bridge::default()))
        .manage(Arc::new(feishu::FeishuState::default()))
        .invoke_handler(tauri::generate_handler![
            core_endpoint,
            personal::personal_directory,
            personal_evolution::personal_reflect,
            personal_evolution::personal_apply_learning,
            close_main_window,
            preferences::login_start_enabled,
            preferences::login_start_set,
            preferences::completion_sound,
            phone_bridge::phone_bridge_config,
            phone_bridge::phone_bridge_reply,
            local_files::local_file_info,
            local_files::local_image_data,
            local_files::prepare_memory_directory,
            skill_packages::skill_stage,
            skill_packages::skill_stage_remove,
            reply_images::reply_image_read,
            reply_images::reply_image_generated,
            reply_images::reply_image_copy,
            reply_images::reply_image_store,
            local_files::local_file_chunk,
            local_files::local_file_save,
            login::heang_login,
            project_links::project_link_open,
            project_links::skill_repository_open,
            project_links::web_link_open,
            login_callback::login_complete,
            login::session_get,
            login::session_set,
            login::session_clear,
            pairing::pairing_identity,
            pairing::pairing_qr,
            pairing::pairing_check_proof,
            pairing::pairing_sas,
            remote_crypto::remote_pin,
            remote_crypto::remote_seal,
            remote_crypto::remote_open,
            pairing::pairing_forget,
            vision::vision_describe,
            feishu::feishu_status,
            feishu::feishu_migrate_legacy,
            feishu::feishu_stop_account,
            feishu_register::feishu_connect_begin,
            feishu::auth::feishu_authorize_begin,
            feishu::feishu_cancel,
            feishu::feishu_disconnect,
            feishu_gateway::feishu_listen_start,
            feishu_gateway::feishu_listen_stop,
            feishu_gateway::feishu_api,
            feishu::auth::feishu_auth_revoke,
            feishu_notice::feishu_owner_notice,
            feishu_notice::feishu_notice_finish,
            feishu_approvals::feishu_approvals_start,
            feishu_approvals::feishu_approvals_stop,
            feishu_tools::feishu_tool_execute
        ])
        .setup({
            let state = Arc::clone(&state);
            move |app| {
                // Windows 使用应用自己的顶栏（与 macOS 的 overlay 标题栏一致），
                // 避免系统深色标题栏落在浅色界面之上；窗口控制按钮在前端绘制。
                // 隐藏失败时保持原生装饰，用户至少还能用系统标题栏操作窗口。
                #[cfg(windows)]
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.set_decorations(false) {
                        log::warn!("failed to hide the native Windows title bar: {e}");
                        #[cfg(windows)]
                        if let Err(retry) = window.set_decorations(true) {
                            log::error!("failed to restore the native Windows title bar: {retry}");
                        }
                    }
                }
                #[cfg(windows)]
                if let Err(e) = tray::install(app.handle()) {
                    log::error!("tray: failed to create the system tray icon, closing the window will quit: {e}");
                }
                if let Err(e) = phone_bridge::start(app.handle().clone()) {
                    log::error!("{e}");
                }
                app.resources_table().add(CoreCleanup(Arc::clone(&state)));
                start_core(app.handle(), state);
                Ok(())
            }
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            tray::on_window_event(window, event);
            #[cfg(not(windows))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(move |_, event| {
            if let RunEvent::Exit = event {
                stop_core(&state);
            }
        }),
        Err(e) => {
            log::error!("failed to build the Lom window: {e}");
            std::process::exit(1);
        }
    }
}
