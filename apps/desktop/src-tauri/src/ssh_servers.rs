use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::ssh_identity::{self, Draft, Prepared};

/// 固定的加固选项：不转发、不复用连接、主机指纹必须已被信任、不弹键盘交互认证。
const HARDENED_OPTIONS: [&str; 8] = [
    "ConnectTimeout=8",
    "StrictHostKeyChecking=yes",
    "ClearAllForwardings=yes",
    "ForwardAgent=no",
    "ForwardX11=no",
    "PermitLocalCommand=no",
    "ControlMaster=no",
    "ControlPath=none",
];

const OUTPUT_LIMIT: usize = 16384;
const ERROR_LIMIT: usize = 8192;
const COMMAND_LIMIT: usize = 4000;

const STATUS_COMMAND: &str = r#"os=$(uname -s) || exit 1
printf 'System: %s\n' "$os"
uptime || exit 1
printf '\nCPU (logical cores): '
getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || printf 'Unavailable\n'
printf '\nMemory:\n'
case "$os" in
  Linux) free -m 2>/dev/null || awk '/^(MemTotal|MemAvailable):/ { print }' /proc/meminfo 2>/dev/null ;;
  Darwin) sysctl hw.memsize 2>/dev/null; vm_stat 2>/dev/null ;;
  *) printf 'Unavailable\n' ;;
esac
printf '\nMounted filesystems (KiB):\n'
df -Pk"#;

fn connection_failure(stderr: &str, status: bool, exit: Option<i32>) -> &'static str {
    if exit.is_some_and(|code| code != 255) && status {
        return "ssh.status_failed：SSH 已连接，但远程状态命令执行失败。";
    }
    let message = stderr.to_ascii_lowercase();
    if message.contains("host key verification failed")
        || message.contains("remote host identification has changed")
    {
        "ssh.host_key：主机指纹未确认或已变化，请在本机核对指纹。"
    } else if message.contains("invalid format") || message.contains("error in libcrypto") {
        "ssh.key_format：私钥格式无效，请重新粘贴 OpenSSH 或 PEM 私钥。"
    } else if message.contains("permission denied")
        || message.contains("authentication failed")
        || message.contains("incorrect passphrase")
    {
        "ssh.auth：SSH 认证失败，请核对用户名、密码或私钥。"
    } else if message.contains("timed out") {
        "ssh.timeout：连接超时，请检查网络和跳板。"
    } else if [
        "connection refused",
        "no route to host",
        "network is unreachable",
        "could not resolve hostname",
    ]
    .iter()
    .any(|reason| message.contains(reason))
    {
        "ssh.network：服务器不可达，请检查地址、端口和跳板。"
    } else {
        "ssh.failed：SSH 探测失败，请检查服务器及本机 SSH 配置。"
    }
}

fn bounded_output(mut stream: impl Read, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            return Ok(output);
        }
        output.extend_from_slice(&buffer[..count.min(limit.saturating_sub(output.len()))]);
    }
}

fn safe_name(s: &str) -> bool {
    s.as_bytes()
        .first()
        .is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_')
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
}

fn valid_destination(destination: &str) -> bool {
    if destination.len() > 255 {
        return false;
    }
    let host = if let Some((user, host)) = destination.split_once('@') {
        if !safe_name(user) {
            return false;
        }
        host
    } else {
        destination
    };
    safe_name(host) || host.parse::<std::net::Ipv6Addr>().is_ok()
}

fn ssh_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .map(|root| root.join("System32").join("OpenSSH").join("ssh.exe"))
    }
    #[cfg(not(windows))]
    {
        Some(PathBuf::from("/usr/bin/ssh"))
    }
}

fn ssh_command(
    destination: &str,
    port: Option<u16>,
    remote: &str,
    auth: &Prepared,
) -> Result<Command, &'static str> {
    if !valid_destination(destination) || port == Some(0) {
        return Err("ssh.invalid_target：SSH 主机或端口无效。");
    }
    let executable = ssh_path().ok_or("ssh.unavailable：系统 OpenSSH 不可用。")?;
    let mut command = Command::new(executable);
    command.arg("-nT");
    for option in HARDENED_OPTIONS {
        command.args(["-o", option]);
    }
    if let Some(port) = port {
        command.arg("-p").arg(port.to_string());
    }
    if let Some(path) = auth.identity() {
        command.args(["-o", "IdentitiesOnly=yes", "-i"]).arg(path);
    }
    if let Some(script) = auth.askpass() {
        // 密码或密钥密码只通过 askpass 脚本交给 ssh，不出现在命令行或环境变量里。
        let method = if auth.password() {
            "PreferredAuthentications=password"
        } else {
            "PreferredAuthentications=publickey"
        };
        command.args([
            "-o",
            "BatchMode=no",
            "-o",
            method,
            "-o",
            "NumberOfPasswordPrompts=1",
        ]);
        command
            .env("SSH_ASKPASS", script)
            .env("SSH_ASKPASS_REQUIRE", "force");
    } else {
        command.args(["-o", "BatchMode=yes"]);
    }
    command.args(["--", destination, remote]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("LC_ALL", "C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

struct Finished {
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// 运行一次 ssh：有界输出、整体超时；超时会杀掉进程。
fn run(
    destination: &str,
    port: Option<u16>,
    remote: &str,
    auth: &Prepared,
    limit: Duration,
) -> Result<Finished, &'static str> {
    let mut child = ssh_command(destination, port, remote, auth)?
        .spawn()
        .map_err(|_| "ssh.unavailable：无法启动系统 OpenSSH。")?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("ssh.output：无法读取 SSH 输出。");
    };
    let reader = std::thread::spawn(move || bounded_output(stdout, OUTPUT_LIMIT));
    let errors = std::thread::spawn(move || bounded_output(stderr, ERROR_LIMIT));
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(exit)) if reader.is_finished() && errors.is_finished() => {
                let read = |handle: std::thread::JoinHandle<std::io::Result<Vec<u8>>>| {
                    handle.join().ok().and_then(Result::ok)
                };
                return Ok(Finished {
                    code: exit.code(),
                    stdout: read(reader).ok_or("ssh.output：无法读取 SSH 输出。")?,
                    stderr: read(errors).unwrap_or_default(),
                });
            }
            Ok(_) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("ssh.timeout：SSH 连接或命令超时。")
}

fn clean(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}

fn probe(
    destination: &str,
    port: Option<u16>,
    status: bool,
    auth: &Prepared,
) -> Result<String, &'static str> {
    let remote = if status { STATUS_COMMAND } else { "true" };
    let done = run(destination, port, remote, auth, Duration::from_secs(15))?;
    if done.code != Some(0) {
        let stderr = String::from_utf8_lossy(&done.stderr);
        return Err(connection_failure(&stderr, status, done.code));
    }
    Ok(clean(&done.stdout))
}

#[derive(Serialize)]
pub struct ExecResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    truncated: bool,
}

/// 在已保存的机器上执行一条命令；ssh 自身失败（认证、网络等）返回带错误码的错误，
/// 命令本身的非零退出码则如实放进结果。
fn exec(
    destination: &str,
    port: Option<u16>,
    command: &str,
    auth: &Prepared,
    seconds: u64,
) -> Result<ExecResult, &'static str> {
    if command.trim().is_empty() || command.len() > COMMAND_LIMIT || command.contains('\0') {
        return Err("ssh.invalid_command：命令为空、过长或包含非法字符。");
    }
    let done = run(
        destination,
        port,
        command,
        auth,
        Duration::from_secs(seconds),
    )?;
    let stderr = String::from_utf8_lossy(&done.stderr);
    match done.code {
        Some(code) if code != 255 => Ok(ExecResult {
            exit_code: code,
            truncated: done.stdout.len() >= OUTPUT_LIMIT || done.stderr.len() >= ERROR_LIMIT,
            stdout: clean(&done.stdout),
            stderr: clean(stderr.as_bytes()),
        }),
        code => Err(connection_failure(&stderr, false, code)),
    }
}

/// 有表单草稿（且填了内容）时用草稿测试；否则读这台机器已保存的凭据。
fn credentials(
    id: Option<&str>,
    auth: Option<&str>,
    draft: Option<&Draft>,
) -> Result<Prepared, String> {
    if let (Some(kind @ ("password" | "key")), Some(draft)) = (auth, draft) {
        if !draft.secret.is_empty() {
            return ssh_identity::prepare(kind, &draft.secret, draft.passphrase.as_deref());
        }
    }
    id.map_or_else(
        || Ok(Prepared::default()),
        |id| ssh_identity::load_saved(id, auth),
    )
}

#[tauri::command]
pub async fn ssh_server_probe(
    destination: String,
    port: Option<u16>,
    status: bool,
    id: Option<String>,
    auth: Option<String>,
    draft: Option<Draft>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = credentials(id.as_deref(), auth.as_deref(), draft.as_ref())?;
        probe(&destination, port, status, &prepared).map_err(str::to_owned)
    })
    .await
    .map_err(|_| "ssh.worker：SSH 探测进程异常。".to_owned())?
}

#[tauri::command]
pub async fn ssh_server_exec(
    destination: String,
    port: Option<u16>,
    id: String,
    auth: Option<String>,
    command: String,
    timeout_seconds: Option<u64>,
) -> Result<ExecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = credentials(Some(&id), auth.as_deref(), None)?;
        let seconds = timeout_seconds.unwrap_or(30).clamp(1, 120);
        exec(&destination, port, &command, &prepared, seconds).map_err(str::to_owned)
    })
    .await
    .map_err(|_| "ssh.worker：SSH 进程异常。".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_01_probe_uses_a_fixed_remote_command() {
        let command = ssh_command(
            "ops@server.example",
            Some(2222),
            STATUS_COMMAND,
            &Prepared::default(),
        )
        .expect("valid SSH target");
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(
            args[args.len() - 3..],
            ["--", "ops@server.example", STATUS_COMMAND]
        );
        assert!(args.iter().any(|arg| *arg == "StrictHostKeyChecking=yes"));
        assert!(args.iter().any(|arg| *arg == "BatchMode=yes"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn ssh_01_imported_identity_is_used_for_probe() {
        let key = "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----";
        let prepared = ssh_identity::prepare("key", key, None).expect("prepared key");
        let command =
            ssh_command("server.example", None, "true", &prepared).expect("valid SSH target");
        let args: Vec<_> = command.get_args().collect();
        let identity = prepared.identity().expect("identity file");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i".as_ref(), identity.as_os_str()]));
        assert!(args.iter().any(|arg| *arg == "IdentitiesOnly=yes"));
        assert!(args.iter().any(|arg| *arg == "BatchMode=yes"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn ssh_02_password_login_uses_askpass_without_leaking_the_secret() {
        let prepared = ssh_identity::prepare("password", "hunter2-secret", None).expect("prepared");
        let command =
            ssh_command("ops@server.example", Some(22), "true", &prepared).expect("valid target");
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect();
        assert!(args
            .iter()
            .any(|arg| arg == "PreferredAuthentications=password"));
        assert!(args.iter().any(|arg| arg == "BatchMode=no"));
        assert!(!args.iter().any(|arg| arg.contains("hunter2-secret")));
        let envs: Vec<_> = command.get_envs().collect();
        assert!(envs.iter().any(|(name, _)| *name == "SSH_ASKPASS"));
        assert!(envs.iter().all(|(_, value)| {
            value.is_none_or(|value| !value.to_string_lossy().contains("hunter2-secret"))
        }));
    }

    #[test]
    fn ssh_02_probe_prefers_the_form_draft_and_rejects_missing_saved_secrets() {
        let id = "3f1c2b8e-7d4a-4f6e-9a1b-0c2d3e4f5a6b";
        let none = credentials(Some(id), None, None).expect("system auth needs no secret");
        assert!(none.identity().is_none() && none.askpass().is_none());
        let draft = Draft {
            secret: String::new(),
            passphrase: None,
        };
        assert!(credentials(None, Some("password"), Some(&draft)).is_ok());
    }

    #[test]
    fn ssh_01_reports_distinct_connection_failures() {
        for (message, code) in [
            ("Host key verification failed.", "ssh.host_key"),
            ("Permission denied (publickey).", "ssh.auth"),
            ("Connection timed out", "ssh.timeout"),
            ("Connection refused", "ssh.network"),
        ] {
            assert!(connection_failure(message, false, Some(255)).starts_with(code));
        }
        let invalid = "Load key \"/tmp/x\": invalid format";
        assert!(connection_failure(invalid, false, Some(255)).starts_with("ssh.key_format"));
    }

    #[test]
    fn ssh_01_rejects_option_injection() {
        for target in [
            "-oProxyCommand=bad",
            "server uptime",
            "a@b@host",
            "a\nHost evil",
        ] {
            assert!(ssh_command(target, None, "true", &Prepared::default()).is_err());
        }
        assert!(ssh_command("ops@2001:db8::1", None, "true", &Prepared::default()).is_ok());
    }

    #[test]
    fn ssh_03_exec_passes_the_command_as_one_argument_after_the_destination() {
        let command = ssh_command(
            "ops@server.example",
            None,
            "ls -l; echo done",
            &Prepared::default(),
        )
        .expect("valid target");
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(
            args[args.len() - 3..],
            ["--", "ops@server.example", "ls -l; echo done"]
        );
        assert!(args.iter().any(|arg| *arg == "ClearAllForwardings=yes"));
    }

    #[test]
    fn ssh_03_exec_rejects_empty_oversized_or_nul_commands() {
        let none = Prepared::default();
        for bad in ["", "   ", "a\0b", &"x".repeat(COMMAND_LIMIT + 1)] {
            let error = exec("server.example", None, bad, &none, 5)
                .err()
                .expect("rejected");
            assert!(error.starts_with("ssh.invalid_command"));
        }
        assert!(exec("-oProxyCommand=bad", None, "id", &none, 5)
            .err()
            .expect("rejected")
            .starts_with("ssh.invalid_target"));
    }
}
