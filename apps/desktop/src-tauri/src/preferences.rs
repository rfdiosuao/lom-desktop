//! OS-backed preferences. Never report a successful setting based on renderer state alone.
use std::{fs, path::PathBuf};

const LABEL: &str = "org.lom.community.desktop.login";
fn launch_path() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("此系统暂不支持登录启动设置".into());
    }
    Ok(dirs::home_dir()
        .ok_or("无法读取用户目录")?
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist")))
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn plist(exe: &str) -> String {
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>Label</key><string>{LABEL}</string><key>ProgramArguments</key><array><string>{}</string></array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string></dict></plist>", xml(exe))
}
#[tauri::command]
pub fn login_start_enabled() -> Result<bool, String> {
    let path = launch_path()?;
    if !path.exists() {
        return Ok(false);
    }
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let saved = fs::read_to_string(path).map_err(|e| e.to_string())?;
    // A moved/replaced app must be explicitly re-enabled rather than launching an old build.
    Ok(saved == plist(&current.to_string_lossy()))
}
#[tauri::command]
pub fn login_start_set(enabled: bool) -> Result<bool, String> {
    let path = launch_path()?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        if !exe.to_string_lossy().contains(".app/Contents/MacOS/") {
            return Err("请在已打包的 Lom 应用中设置登录启动".into());
        }
        fs::create_dir_all(path.parent().ok_or("启动目录无效")?).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("plist.tmp");
        fs::write(&tmp, plist(&exe.to_string_lossy())).map_err(|e| e.to_string())?;
        fs::rename(tmp, &path).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    login_start_enabled()
}
#[tauri::command]
pub async fn completion_sound() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("系统提示音暂不可用".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        let status = std::process::Command::new("/usr/bin/afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("系统提示音播放失败".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    #[test]
    fn login_path_is_a_single_escaped_argument() {
        let body = super::plist("/tmp/A & <B> \"C\".app/Contents/MacOS/Lom");
        assert!(body.contains("A &amp; &lt;B&gt; &quot;C&quot;"));
        assert!(!body.contains("KeepAlive"));
        assert!(!body.contains("/bin/sh"));
    }
}
