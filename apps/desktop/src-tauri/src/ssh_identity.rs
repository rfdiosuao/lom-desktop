use serde::Deserialize;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::time::Duration;

/// Community credentials never share service names with the commercial app.
const KEY_SERVICE: &str = "org.lom.community.desktop.ssh";
const PASSWORD_SERVICE: &str = "org.lom.community.desktop.ssh.password";
const PASSPHRASE_SERVICE: &str = "org.lom.community.desktop.ssh.passphrase";
#[cfg(target_os = "macos")]
const IDENTITY_DIR: &str = "lom-community-ssh-identities";
#[cfg(target_os = "macos")]
const KEY_LIMIT: usize = 65536;
/// 崩溃或被强杀留下的私钥只在一小时后才清理，避免误删另一个实例正在进行的探测。
#[cfg(target_os = "macos")]
const STALE_AFTER: Duration = Duration::from_secs(60 * 60);
#[cfg(not(target_os = "macos"))]
const PLATFORM_ERROR: &str = "ssh.key_platform：当前平台请通过系统 SSH 配置使用密钥。";

fn entry(service: &str, id: &str) -> Result<keyring::Entry, String> {
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("ssh.key_id：服务器标识无效。".into());
    }
    keyring::Entry::new(service, id).map_err(|_| "ssh.key_store：无法访问系统钥匙串。".into())
}

fn forget(service: &str, id: &str) -> Result<(), String> {
    match entry(service, id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("ssh.key_store：无法移除已保存的凭据。".into()),
    }
}

/// 表单里尚未保存的凭据：只在内存里短暂存在，故意不实现 Debug，避免被日志带出。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub secret: String,
    pub passphrase: Option<String>,
}

#[tauri::command]
pub async fn ssh_secret_store(id: String, auth: String, draft: Draft) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store(&id, &auth, &draft))
        .await
        .map_err(|_| "ssh.key_worker：保存凭据失败。".to_owned())?
}

#[tauri::command]
pub fn ssh_identity_remove(id: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    [KEY_SERVICE, PASSWORD_SERVICE, PASSPHRASE_SERVICE]
        .iter()
        .try_for_each(|service| forget(service, &id))
}

/// 一次连接用到的临时凭据文件；离开作用域即删除。
pub struct IdentityFile(PathBuf);

impl IdentityFile {
    /// 只有写临时凭据文件的 macOS 代码需要路径；其它平台不存在这些文件。
    #[cfg(target_os = "macos")]
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for IdentityFile {
    fn drop(&mut self) {
        if std::fs::remove_file(&self.0).is_err() {
            log::warn!("ssh.key_cleanup：临时 SSH 凭据清理失败");
        }
    }
}

/// 一次连接的凭据：可选私钥文件，加上可选的 askpass 脚本（密码或密钥密码）。
#[derive(Default)]
pub struct Prepared {
    _guards: Vec<IdentityFile>,
    identity: Option<PathBuf>,
    askpass: Option<PathBuf>,
    password: bool,
}

impl Prepared {
    pub fn identity(&self) -> Option<&Path> {
        self.identity.as_deref()
    }
    pub fn askpass(&self) -> Option<&Path> {
        self.askpass.as_deref()
    }
    /// 为 true 时只允许密码认证，否则只允许公钥认证。
    pub fn password(&self) -> bool {
        self.password
    }
}

/// 临时私钥只放在本账号独占的 0700 目录里，不再和其它临时文件混在 $TMPDIR 根下。
#[cfg(target_os = "macos")]
fn identity_dir() -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(IDENTITY_DIR);
    std::fs::create_dir_all(&dir).map_err(|_| "ssh.key_temp：无法创建临时凭据目录。")?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| "ssh.key_temp：无法保护临时凭据目录。")?;
    Ok(dir)
}

/// 启动时清理上次进程崩溃留下的私钥；正常退出由 [`IdentityFile`] 的 Drop 负责。
pub fn sweep_stale_identities() {
    #[cfg(target_os = "macos")]
    {
        let Ok(dir) = identity_dir() else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return;
        };
        let now = std::time::SystemTime::now();
        let removed = entries
            .flatten()
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|kind| kind.is_file())
                    .unwrap_or(false)
            })
            .filter(|entry| {
                entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|modified| now.duration_since(modified).ok())
                    .is_some_and(|age| age >= STALE_AFTER)
            })
            .filter(|entry| std::fs::remove_file(entry.path()).is_ok())
            .count();
        if removed > 0 {
            log::warn!("ssh.key_cleanup：已清理 {removed} 个残留的临时 SSH 凭据");
        }
    }
}

#[cfg(target_os = "macos")]
fn materialize(contents: &str, mode: u32) -> Result<IdentityFile, String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "ssh.key_temp：无法生成临时凭据标识。")?;
    let name: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let path = identity_dir()?.join(name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(&path)
        .map_err(|_| "ssh.key_temp：无法创建受保护的临时凭据。")?;
    let identity = IdentityFile(path);
    file.write_all(contents.as_bytes())
        .map_err(|_| "ssh.key_temp：无法准备连接凭据。")?;
    Ok(identity)
}

/// 只接受 OpenSSH 或 PEM 私钥；统一换行并补结尾换行。
#[cfg(target_os = "macos")]
fn normalize_key(secret: &str) -> Result<String, String> {
    let mut key = secret.trim().replace("\r\n", "\n");
    let header = key.lines().next().unwrap_or_default();
    if key.len() > KEY_LIMIT
        || !header.starts_with("-----BEGIN ")
        || !header.ends_with("PRIVATE KEY-----")
    {
        return Err("ssh.key_format：请粘贴 OpenSSH 或 PEM 格式的私钥。".into());
    }
    key.push('\n');
    Ok(key)
}

#[cfg(target_os = "macos")]
fn validate_key(secret: &str) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let identity = materialize(secret, 0o600)?;
    let status = Command::new("/usr/bin/ssh-keygen")
        .args(["-y", "-P", "", "-f"])
        .arg(identity.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "ssh.key_format：无法验证私钥。")?;
    if status.success() {
        Ok(())
    } else {
        Err("ssh.key_format：私钥无效，或受口令保护而未填写「密钥密码」。".into())
    }
}

#[cfg(target_os = "macos")]
fn check_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() || secret.contains(['\n', '\r', '\0']) {
        return Err("ssh.secret_format：密码不能为空，也不能包含换行。".into());
    }
    Ok(())
}

/// askpass 脚本只读取同目录下的一个 0600 文件；两者都在连接结束后删除。
#[cfg(target_os = "macos")]
fn askpass(secret: &str) -> Result<(IdentityFile, IdentityFile), String> {
    check_secret(secret)?;
    let content = materialize(&format!("{secret}\n"), 0o600)?;
    let path = content.path().to_string_lossy().into_owned();
    if path.contains('\'') {
        return Err("ssh.key_temp：临时凭据路径不受支持。".into());
    }
    let script = materialize(&format!("#!/bin/sh\nexec /bin/cat -- '{path}'\n"), 0o700)?;
    Ok((script, content))
}

#[cfg(target_os = "macos")]
fn prepare_key(secret: &str, passphrase: Option<&str>) -> Result<Prepared, String> {
    let identity = materialize(&normalize_key(secret)?, 0o600)?;
    let mut prepared = Prepared {
        identity: Some(identity.path().to_path_buf()),
        ..Prepared::default()
    };
    prepared._guards.push(identity);
    if let Some(passphrase) = passphrase.filter(|p| !p.is_empty()) {
        let (script, content) = askpass(passphrase)?;
        prepared.askpass = Some(script.path().to_path_buf());
        prepared._guards.extend([script, content]);
    }
    Ok(prepared)
}

/// 按验证方式（password / key）把表单或钥匙串里的凭据落成一次连接要用的临时文件。
#[cfg(target_os = "macos")]
pub fn prepare(auth: &str, secret: &str, passphrase: Option<&str>) -> Result<Prepared, String> {
    match auth {
        "password" => {
            let (script, content) = askpass(secret)?;
            Ok(Prepared {
                askpass: Some(script.path().to_path_buf()),
                password: true,
                _guards: vec![script, content],
                ..Prepared::default()
            })
        }
        "key" => prepare_key(secret, passphrase),
        _ => Ok(Prepared::default()),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prepare(auth: &str, _secret: &str, _passphrase: Option<&str>) -> Result<Prepared, String> {
    match auth {
        "password" | "key" => Err(PLATFORM_ERROR.into()),
        _ => Ok(Prepared::default()),
    }
}

#[cfg(target_os = "macos")]
fn saved(service: &str, id: &str) -> Result<Option<String>, String> {
    match entry(service, id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("ssh.key_store：无法读取系统钥匙串。".into()),
    }
}

/// 读取已保存的凭据。没有 auth（旧记录）或 system 时，仍沿用此前导入的私钥（如果有）。
#[cfg(target_os = "macos")]
pub fn load_saved(id: &str, auth: Option<&str>) -> Result<Prepared, String> {
    let missing =
        |what: &str| format!("ssh.secret_missing：尚未保存{what}，请编辑这台机器并填写。");
    if auth == Some("password") {
        let password = saved(PASSWORD_SERVICE, id)?.ok_or_else(|| missing("密码"))?;
        return prepare("password", &password, None);
    }
    match saved(KEY_SERVICE, id)? {
        Some(key) => prepare_key(&key, saved(PASSPHRASE_SERVICE, id)?.as_deref()),
        None if auth == Some("key") => Err(missing("私钥")),
        None => Ok(Prepared::default()),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn load_saved(_id: &str, auth: Option<&str>) -> Result<Prepared, String> {
    match auth {
        Some("password" | "key") => Err(PLATFORM_ERROR.into()),
        _ => Ok(Prepared::default()),
    }
}

/// 把新凭据写进系统钥匙串，并清掉同一台机器上另一种验证方式留下的凭据。
#[cfg(target_os = "macos")]
fn store(id: &str, auth: &str, draft: &Draft) -> Result<(), String> {
    let set = |service: &str, value: &str| {
        entry(service, id)?
            .set_password(value)
            .map_err(|_| "ssh.key_store：无法保存凭据。".to_owned())
    };
    let passphrase = draft.passphrase.as_deref().filter(|p| !p.is_empty());
    match auth {
        "password" => {
            check_secret(&draft.secret)?;
            set(PASSWORD_SERVICE, &draft.secret)?;
            forget(KEY_SERVICE, id)?;
            forget(PASSPHRASE_SERVICE, id)
        }
        "key" => {
            let key = normalize_key(&draft.secret)?;
            if let Some(passphrase) = passphrase {
                check_secret(passphrase)?;
            } else {
                validate_key(&key)?;
            }
            set(KEY_SERVICE, &key)?;
            match passphrase {
                Some(passphrase) => set(PASSPHRASE_SERVICE, passphrase)?,
                None => forget(PASSPHRASE_SERVICE, id)?,
            }
            forget(PASSWORD_SERVICE, id)
        }
        _ => Err("ssh.secret_kind：验证方式无效。".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn store(_id: &str, _auth: &str, _draft: &Draft) -> Result<(), String> {
    Err(PLATFORM_ERROR.into())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const KEY: &str =
        "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n";

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777
    }

    #[test]
    fn community_ssh_credentials_and_temporary_files_use_separate_namespaces() {
        for service in [KEY_SERVICE, PASSWORD_SERVICE, PASSPHRASE_SERVICE] {
            assert!(service.starts_with("org.lom.community.desktop.ssh"));
        }
        let dir = identity_dir().expect("community identity directory");
        assert_eq!(
            dir.file_name().and_then(|name| name.to_str()),
            Some("lom-community-ssh-identities")
        );
    }

    #[test]
    fn ssh_01_private_keys_live_in_a_private_directory() {
        let dir = identity_dir().expect("identity dir");
        assert_eq!(mode(&dir), 0o700);
        let identity = materialize(KEY, 0o600).expect("materialize");
        assert_eq!(identity.path().parent(), Some(dir.as_path()));
        assert_eq!(mode(identity.path()), 0o600);
        let path = identity.path().to_path_buf();
        drop(identity);
        assert!(
            !path.exists(),
            "dropping the identity deletes the private key file"
        );
    }

    #[test]
    fn ssh_01_import_rejects_identifiers_that_are_not_server_ids() {
        for id in ["short", &"z".repeat(36), &"a".repeat(35)] {
            assert!(entry(KEY_SERVICE, id).is_err());
        }
        assert!(entry(KEY_SERVICE, "3f1c2b8e-7d4a-4f6e-9a1b-0c2d3e4f5a6b").is_ok());
    }

    #[test]
    fn ssh_02_password_is_served_by_a_private_self_cleaning_askpass() {
        let prepared = prepare("password", "p@ss word", None).expect("prepared");
        let script = prepared.askpass().expect("askpass script").to_path_buf();
        assert!(prepared.password() && prepared.identity().is_none());
        assert_eq!(mode(&script), 0o700);
        let output = std::process::Command::new(&script)
            .output()
            .expect("run askpass");
        assert_eq!(String::from_utf8_lossy(&output.stdout), "p@ss word\n");
        drop(prepared);
        assert!(!script.exists(), "askpass files are deleted after use");
    }

    #[test]
    fn ssh_02_rejects_unusable_passwords_and_non_private_keys() {
        for secret in ["", "line\nbreak"] {
            assert!(prepare("password", secret, None).is_err());
        }
        assert!(prepare("key", "ssh-ed25519 AAAA public", None).is_err());
        let with_phrase = prepare("key", KEY, Some("phrase")).expect("key with passphrase");
        assert!(with_phrase.identity().is_some() && with_phrase.askpass().is_some());
        assert!(!with_phrase.password());
    }
}
