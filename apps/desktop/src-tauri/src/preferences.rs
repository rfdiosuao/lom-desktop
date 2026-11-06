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
/// Windows 自带的完成提示音，按顺序取第一个存在的文件（不同版本的 Windows 文件名不同）。
const WINDOWS_SOUND_CANDIDATES: [&str; 2] =
    ["Windows Notify System Generic.wav", "Windows Ding.wav"];

/// 在 Media 目录里找第一个存在的提示音文件；找不到返回 None，由调用方报错，不假装播放成功。
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_sound_path(media_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    WINDOWS_SOUND_CANDIDATES
        .iter()
        .map(|name| media_dir.join(name))
        .find(|path| path.is_file())
}

#[tauri::command]
pub async fn completion_sound() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(play_completion_sound)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn play_completion_sound() -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/afplay")
        .arg("/System/Library/Sounds/Glass.aiff")
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("系统提示音播放失败".into())
    }
}

#[cfg(windows)]
fn play_completion_sound() -> Result<(), String> {
    let media = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"))
        .join("Media");
    let path = windows_sound_path(&media).ok_or("找不到 Windows 系统提示音文件")?;
    play_wav_windows(&path)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn play_completion_sound() -> Result<(), String> {
    Err("系统提示音暂不可用".into())
}

#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn PlaySoundW(psz_sound: *const u16, hmod: *mut std::ffi::c_void, fdw_sound: u32) -> i32;
}

/// 同步播放 wav 文件（winmm 的 PlaySoundW，SND_FILENAME）。运行在 spawn_blocking 线程里，不会卡住界面。
#[cfg(windows)]
fn play_wav_windows(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    const SND_FILENAME: u32 = 0x0002_0000;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives the call; the sound is played
    // synchronously, so the buffer is not read after this function returns. No module handle is used.
    let ok = unsafe { PlaySoundW(wide.as_ptr(), std::ptr::null_mut(), SND_FILENAME) };
    if ok != 0 {
        Ok(())
    } else {
        Err("系统提示音播放失败".into())
    }
}
#[cfg(test)]
mod tests {
    fn temp_media_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lom-win-sound-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    #[allow(non_snake_case)]
    fn WIN_SOUND_01_windows_completion_sound_uses_the_first_existing_system_wav() {
        let dir = temp_media_dir("first");
        assert_eq!(
            super::windows_sound_path(&dir),
            None,
            "no sound file means no fake success"
        );
        std::fs::write(dir.join("Windows Ding.wav"), b"RIFF").unwrap();
        assert_eq!(
            super::windows_sound_path(&dir),
            Some(dir.join("Windows Ding.wav"))
        );
        std::fs::write(dir.join("Windows Notify System Generic.wav"), b"RIFF").unwrap();
        assert_eq!(
            super::windows_sound_path(&dir),
            Some(dir.join("Windows Notify System Generic.wav")),
            "the preferred candidate wins when both exist"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn login_path_is_a_single_escaped_argument() {
        let body = super::plist("/tmp/A & <B> \"C\".app/Contents/MacOS/Lom");
        assert!(body.contains("A &amp; &lt;B&gt; &quot;C&quot;"));
        assert!(!body.contains("KeepAlive"));
        assert!(!body.contains("/bin/sh"));
    }
}
