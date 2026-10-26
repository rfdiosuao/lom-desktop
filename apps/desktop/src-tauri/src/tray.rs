//! Windows：关闭主窗口时收进系统托盘，核心继续在后台运行（定时任务、手机桥接、团队都不中断）；
//! 托盘图标左键打开窗口，右键菜单可以打开或真正退出。macOS 不走这里，行为不变。
//! 托盘没装上时不拦截关闭，否则窗口藏起来后就再也找不回来。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};

/// 托盘是否已就绪：只有就绪后关闭窗口才收进托盘
static TRAY_READY: AtomicBool = AtomicBool::new(false);

const MENU_SHOW: &str = "tray-show";
const MENU_QUIT: &str = "tray-quit";

/// 把主窗口拿回前台：显示、取消最小化、聚焦
#[cfg_attr(not(windows), allow(dead_code))]
pub fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("tray: main window not found");
        return;
    };
    if let Err(e) = window.show() {
        log::warn!("tray: failed to show the main window: {e}");
    }
    if let Err(e) = window.unminimize() {
        log::warn!("tray: failed to restore the main window: {e}");
    }
    if let Err(e) = window.set_focus() {
        log::warn!("tray: failed to focus the main window: {e}");
    }
}

/// 创建托盘图标与菜单；失败时返回错误，关闭窗口仍按原样退出
#[cfg_attr(not(windows), allow(dead_code))]
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "打开麓鸣 Lom", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出麓鸣 Lom", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("麓鸣 Lom · 正在后台运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main(app),
            MENU_QUIT => app.exit(0),
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
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    TRAY_READY.store(true, Ordering::SeqCst);
    Ok(())
}

/// 主窗口的关闭请求是否改成收进托盘
#[cfg_attr(not(windows), allow(dead_code))]
pub fn hides_on_close(label: &str, tray_ready: bool) -> bool {
    label == "main" && tray_ready
}

/// 关闭主窗口（自绘关闭按钮、Alt+F4、任务栏关闭）：托盘就绪时隐藏而不退出
#[cfg_attr(not(windows), allow(dead_code))]
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if !hides_on_close(window.label(), TRAY_READY.load(Ordering::SeqCst)) {
        return;
    }
    api.prevent_close();
    if let Err(e) = window.hide() {
        log::warn!("tray: failed to hide the main window: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::hides_on_close;

    #[test]
    fn tray_only_the_main_window_hides_and_only_once_the_tray_exists() {
        assert!(hides_on_close("main", true));
        assert!(
            !hides_on_close("main", false),
            "without a tray the window must really close"
        );
        assert!(!hides_on_close("personal", true));
    }
}
