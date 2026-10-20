mod documents;
mod runtime;
mod sidecar;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[derive(Default)]
struct TrayAvailable(AtomicBool);

pub fn run() {
    let state = Arc::new(runtime::Runtime::default());
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&state))
        .manage(TrayAvailable::default())
        .invoke_handler(tauri::generate_handler![
            documents::open_document,
            documents::save_document,
            runtime::core_endpoint,
            runtime::restart_core,
            runtime::core_status
        ])
        .setup({
            let state = Arc::clone(&state);
            move |app| {
                match build_tray(app.handle()) {
                    Ok(()) => {
                        app.state::<TrayAvailable>()
                            .0
                            .store(true, Ordering::Relaxed);
                    }
                    Err(error) => eprintln!("tray unavailable: {error}"),
                }
                runtime::start(app.handle().clone(), Arc::clone(&state));
                Ok(())
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window keeps the core (and scheduled work) alive.
                // The tray menu owns the explicit quit path. Without a tray there
                // is no way back to the window, so fall back to a normal exit.
                if window
                    .app_handle()
                    .state::<TrayAvailable>()
                    .0
                    .load(Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(move |_, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = state.shutdown();
            }
        }),
        Err(error) => {
            eprintln!("Desktop window failed: {error}");
            let _ = state.shutdown();
            std::process::exit(1);
        }
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "重启核心服务", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Lom", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &restart, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Lom")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "restart" => {
                let state = (*app.state::<Arc<runtime::Runtime>>()).clone();
                std::thread::spawn(move || {
                    let _ = state.restart_blocking();
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
