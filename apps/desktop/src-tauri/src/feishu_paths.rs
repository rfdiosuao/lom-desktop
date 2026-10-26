//! FEISHU-04：lark-cli 配置目录放在哪。
//!
//! lark-cli 的事件总线在配置目录下建 unix socket（`events/<appId>/bus.sock`），macOS 规定 socket 路径不超过
//! 104 字节。放在 `~/Library/Application Support/top.heang.lom/feishu/<哈希>` 时路径有 122 字节，总线起不来，
//! 收不到任何飞书消息。所以 macOS / Linux 放在 `~/.lom/feishu/<12 位哈希>`（家目录过长时退到 `/tmp`），
//! Windows 用命名管道、没有这个限制，仍在应用数据目录。早期放在应用数据目录里的配置第一次使用时搬过来。

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// `events/cli_<16 位>/bus.sock` 的长度，加上分隔符
const SOCKET_SUFFIX: usize = "/events/cli_0123456789abcdef/bus.sock".len();
/// macOS sun_path 104 字节（含结尾 0），留一点余量
const SOCKET_LIMIT: usize = 100;

/// 每个 Lom 账号一个目录：用账号 ID 的哈希命名，目录名里不出现账号本身
pub fn account_dir(base: &Path, account: &str) -> PathBuf {
    let hash = Sha256::digest(account.as_bytes());
    let name: String = hash.iter().take(6).map(|b| format!("{b:02x}")).collect();
    base.join("feishu").join(name)
}

/// Independent configuration namespace; tuple encoding cannot alias an account directory.
pub fn scoped_dir(base: &Path, account: &str, assistant: &str) -> PathBuf {
    account_dir(
        base,
        &format!(
            "v2:{}:{account}:{}:{assistant}",
            account.len(),
            assistant.len()
        ),
    )
}

pub(crate) fn scoped_config_dir(
    app: &AppHandle,
    account: &str,
    assistant: &str,
) -> Result<PathBuf, String> {
    validate_scope(account, assistant)?;
    let legacy = config_dir(app, account)?;
    if let Some(owner) = legacy_owner(&legacy)? {
        if owner == assistant {
            return Ok(legacy);
        }
    }
    let mut dir = scoped_dir(&base(app)?, account, assistant);
    if !socket_fits(&dir) {
        dir = scoped_dir(Path::new("/tmp/lom"), account, assistant);
    }
    if !socket_fits(&dir) {
        return Err("feishu.path_too_long".into());
    }
    create_private(&dir)?;
    Ok(dir)
}
pub(crate) fn validate_scope(account: &str, assistant: &str) -> Result<(), String> {
    if account.is_empty() || account.len() > 128 {
        return Err("feishu.account_invalid".into());
    }
    if assistant.is_empty() || assistant.len() > 128 {
        return Err("feishu.assistant_invalid".into());
    }
    Ok(())
}
pub(crate) fn legacy_owner(dir: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(dir.join("lom-assistant-owner.json")) {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|_| "feishu.migration_invalid".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("feishu.migration_failed".into()),
    }
}
pub(crate) fn claim_legacy(dir: &Path, assistant: &str) -> Result<(), String> {
    if let Some(owner) = legacy_owner(dir)? {
        return if owner == assistant {
            Ok(())
        } else {
            Err("feishu.binding_owned".into())
        };
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join("lom-assistant-owner.json"))
        .map_err(|_| "feishu.migration_failed")?;
    file.write_all(
        serde_json::to_string(assistant)
            .map_err(|_| "feishu.migration_failed")?
            .as_bytes(),
    )
    .map_err(|_| "feishu.migration_failed".into())
}

/// Persist non-secret app ownership independently from removable CLI configuration.
pub(crate) fn claim_app(
    app: &AppHandle,
    account: &str,
    assistant: &str,
    app_id: &str,
) -> Result<(), String> {
    static CLAIMS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = CLAIMS.lock().map_err(|_| "feishu.state_failed")?;
    let path = config_dir(app, account)?.join("lom-app-owners.json");
    let mut owners: std::collections::HashMap<String, String> = match std::fs::read_to_string(&path)
    {
        Ok(raw) => serde_json::from_str(&raw).map_err(|_| "feishu.binding_invalid")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Default::default(),
        Err(_) => return Err("feishu.state_failed".into()),
    };
    if owners.get(app_id).is_some_and(|owner| owner != assistant) {
        return Err("feishu.binding_owned".into());
    }
    owners.insert(app_id.into(), assistant.into());
    let raw = serde_json::to_vec(&owners).map_err(|_| "feishu.state_failed")?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, raw)
        .and_then(|_| std::fs::rename(&temporary, path))
        .map_err(|_| "feishu.state_failed".into())
}

/// 这个目录下 lark-cli 的事件总线 socket 能不能建起来
pub fn socket_fits(dir: &Path) -> bool {
    cfg!(windows) || dir.as_os_str().len() + SOCKET_SUFFIX <= SOCKET_LIMIT
}

/// 早期版本的目录（应用数据目录下、24 位哈希）
fn legacy_dir(app_data: &Path, account: &str) -> PathBuf {
    let hash = Sha256::digest(account.as_bytes());
    let name: String = hash.iter().take(12).map(|b| format!("{b:02x}")).collect();
    app_data.join("feishu").join(name)
}

/// 新目录还没有配置、旧目录有：整个搬过来（扫码建的应用和授权都在里面，凭据本身在钥匙串里不受影响）
pub fn migrate(legacy: &Path, dir: &Path) -> Result<(), String> {
    if dir.join("config.json").exists() || !legacy.join("config.json").exists() {
        return Ok(());
    }
    if let Some(parent) = dir.parent() {
        create_private(parent)?;
    }
    // 新位置可能已有空目录或日志：删得掉才整体改名，否则只复制配置
    if (!dir.exists() || std::fs::remove_dir(dir).is_ok()) && std::fs::rename(legacy, dir).is_ok() {
        return Ok(());
    }
    // 跨磁盘时只复制配置文件；缓存和日志可以重建
    create_private(dir)?;
    std::fs::copy(legacy.join("config.json"), dir.join("config.json"))
        .map(|_| ())
        .map_err(|e| format!("feishu.migrate: {e}"))
}

fn create_private(dir: &Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(dir)
        .map_err(|e| format!("feishu.data_dir: {e}"))
}

fn base(app: &AppHandle) -> Result<PathBuf, String> {
    let data = || {
        app.path()
            .app_data_dir()
            .map_err(|e| format!("feishu.data_dir: {e}"))
    };
    if cfg!(windows) {
        return data();
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("feishu.data_dir: {e}"))?;
    Ok(home.join(".lom"))
}

pub(crate) fn config_dir(app: &AppHandle, account: &str) -> Result<PathBuf, String> {
    if account.is_empty() || account.len() > 128 {
        return Err("feishu.account_invalid".into());
    }
    let mut dir = account_dir(&base(app)?, account);
    if !socket_fits(&dir) {
        dir = account_dir(Path::new("/tmp/lom"), account);
    }
    if !socket_fits(&dir) {
        return Err("feishu.path_too_long".into());
    }
    if let Ok(data) = app.path().app_data_dir() {
        let legacy = legacy_dir(&data, account);
        if legacy != dir {
            migrate(&legacy, &dir)?;
        }
    }
    create_private(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feishu_multi_legacy_alias_preserves_files_and_exclusive_owner() {
        let root = std::env::temp_dir().join(format!("lom-feishu-multi-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("config.json"), "original").unwrap();
        std::fs::write(root.join("owner.json"), "owner").unwrap();
        assert!(claim_legacy(&root, "a").is_ok());
        assert!(claim_legacy(&root, "a").is_ok());
        assert_eq!(claim_legacy(&root, "b"), Err("feishu.binding_owned".into()));
        assert_eq!(
            std::fs::read_to_string(root.join("config.json")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("owner.json")).unwrap(),
            "owner"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn feishu_multi_assistant_paths_are_independent_and_short() {
        let base = Path::new("/Users/a/.lom");
        assert_ne!(
            scoped_dir(base, "account", "a"),
            scoped_dir(base, "account", "b")
        );
        assert_ne!(
            scoped_dir(base, "account", "a"),
            account_dir(base, "account")
        );
        assert!(socket_fits(&scoped_dir(base, "account", "a")));
    }

    #[test]
    fn feishu_04_the_event_bus_socket_fits_under_the_macos_limit() {
        let dir = account_dir(Path::new("/Users/a1-6/.lom"), "acc-1");
        assert!(socket_fits(&dir), "{}", dir.display());
        // 早期的位置正是因为超长才收不到消息
        let old = legacy_dir(
            Path::new("/Users/a1-6/Library/Application Support/top.heang.lom"),
            "acc-1",
        );
        assert!(cfg!(windows) || !socket_fits(&old));
        assert_eq!(
            account_dir(Path::new("/b"), "acc-1"),
            account_dir(Path::new("/b"), "acc-1")
        );
        assert_ne!(
            account_dir(Path::new("/b"), "acc-1"),
            account_dir(Path::new("/b"), "acc-2")
        );
        assert!(!account_dir(Path::new("/b"), "acc-1")
            .to_string_lossy()
            .contains("acc-1"));
    }

    #[test]
    fn feishu_04_an_existing_connection_moves_to_the_new_place_without_rescanning() {
        let root = std::env::temp_dir().join(format!("lom-feishu-04-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let legacy = root.join("old/feishu/aaaa");
        let dir = root.join("new/feishu/bbbb");
        std::fs::create_dir_all(legacy.join("cache")).unwrap();
        std::fs::write(legacy.join("config.json"), r#"{"apps":[]}"#).unwrap();
        migrate(&legacy, &dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("config.json")).unwrap(),
            r#"{"apps":[]}"#
        );
        assert!(dir.join("cache").is_dir());
        assert!(!legacy.exists());
        // 已经搬过、或新位置已有配置时不再动
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("config.json"), "stale").unwrap();
        migrate(&legacy, &dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("config.json")).unwrap(),
            r#"{"apps":[]}"#
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
