//! 以 sidecar 方式启动 lom-core（运行时另行提供）。
//!
//! - 每次启动随机选择本机端口，生成一次性启动令牌（`LOM_LAUNCH_TOKEN`），令牌只在内存与子进程环境变量中。
//! - 传入 `--parent-pid`：外壳异常退出时核心会自行结束；正常退出时外壳主动结束它。
//! - 等 `/health` 返回 200 后才把连接信息交给前端。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// 前端拿到的连接信息（仅用于桌面本机连接）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub url: String,
    pub token: String,
    pub default_folder: String,
    pub home_dir: String,
}

/// 启动失败的原因，带错误码（`core.<原因>`）
#[derive(Debug, Clone)]
pub struct SidecarError {
    pub code: &'static str,
    pub detail: String,
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

fn err(code: &'static str, detail: impl std::fmt::Display) -> SidecarError {
    SidecarError {
        code,
        detail: detail.to_string(),
    }
}

pub struct Sidecar {
    pub endpoint: Endpoint,
    pub child: Child,
}

/// Opt-in only: never locate, download or bundle a private engine automatically.
fn core_binary() -> Result<PathBuf, SidecarError> {
    configured_binary(std::env::var_os("LOM_CORE_BIN"))
}

fn configured_binary(value: Option<std::ffi::OsString>) -> Result<PathBuf, SidecarError> {
    let path = value.map(PathBuf::from).ok_or_else(|| {
        err(
            "core.not_configured",
            "请先设置 LOM_CORE_BIN；本地文档功能无需运行时",
        )
    })?;
    if !path.is_absolute() || !path.is_file() {
        return Err(err(
            "core.invalid_binary",
            "LOM_CORE_BIN 必须为已安装运行时的绝对文件路径",
        ));
    }
    Ok(path)
}

fn free_port() -> Result<u16, SidecarError> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| err("core.no_port", e))?;
    l.local_addr()
        .map(|a| a.port())
        .map_err(|e| err("core.no_port", e))
}

fn random_token() -> Result<String, SidecarError> {
    let mut buf = [0u8; 24];
    getrandom::fill(&mut buf).map_err(|e| err("core.token_failed", e))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

fn healthy(port: u16) -> bool {
    let Ok(mut s) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300))
    else {
        return false;
    };
    // 设置超时失败时继续：最坏情况是这一次探测慢一些，外层仍有 40 秒总时限
    let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
    if s.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut head = [0u8; 16];
    matches!(s.read(&mut head), Ok(n) if n >= 12 && head.starts_with(b"HTTP/1.1 200"))
}

fn ensure_dir(p: &Path) -> Result<(), SidecarError> {
    std::fs::create_dir_all(p).map_err(|e| err("core.dir_failed", format!("{}: {e}", p.display())))
}

/// 启动核心并等待就绪；`data_dir` 为应用数据目录
pub fn start(data_dir: &Path) -> Result<Sidecar, SidecarError> {
    let bin = core_binary()?;
    let port = free_port()?;
    let token = random_token()?;
    let home = dirs::home_dir().ok_or_else(|| err("core.no_home", "找不到用户主目录"))?;
    let default_folder = data_dir.join("workspace");
    let work_dir = data_dir.join("work");
    let log_dir = data_dir.join("logs");
    for d in [data_dir, &work_dir, &log_dir, &default_folder] {
        ensure_dir(d)?;
    }
    let child = Command::new(&bin)
        .args([
            "--local",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--work-dir")
        .arg(&work_dir)
        .arg("--log-dir")
        .arg(&log_dir)
        .args([
            "--parent-pid",
            &std::process::id().to_string(),
            "--log-level",
            "info",
        ])
        .env("LOM_LAUNCH_TOKEN", &token)
        // Keep temporary attachments in the desktop application namespace.
        .env("LOM_TEMP_NAMESPACE", "lom")
        .env(
            "LOM_ALLOWED_ORIGINS",
            "http://127.0.0.1:1420,http://localhost:1420",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| err("core.spawn_failed", format!("{}: {e}", bin.display())))?;
    let mut sidecar = Sidecar {
        endpoint: Endpoint {
            url: format!("http://127.0.0.1:{port}"),
            token,
            default_folder: default_folder.to_string_lossy().into_owned(),
            home_dir: home.to_string_lossy().into_owned(),
        },
        child,
    };
    let deadline = Instant::now() + Duration::from_secs(40);
    while Instant::now() < deadline {
        if let Ok(Some(status)) = sidecar.child.try_wait() {
            return Err(err(
                "core.exited",
                format!("核心启动后退出（{status}），日志见 {}", log_dir.display()),
            ));
        }
        if healthy(port) {
            return Ok(sidecar);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    // 尽力结束未就绪的子进程；即使失败，--parent-pid 也会让它在外壳退出时结束
    let _ = sidecar.child.kill();
    let _ = sidecar.child.wait();
    Err(err(
        "core.start_timeout",
        format!("40 秒内没有就绪，日志见 {}", log_dir.display()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_is_explicit_and_requires_an_existing_absolute_file() {
        assert!(configured_binary(None).is_err());
        assert!(configured_binary(Some("relative-runtime".into())).is_err());
        let current = std::env::current_exe().expect("test executable");
        assert!(configured_binary(Some(current.into_os_string())).is_ok());
    }

    #[test]
    fn launch_tokens_are_ephemeral_random_hex() {
        let first = random_token().expect("test entropy");
        let second = random_token().expect("test entropy");
        assert!(first.len() == 48 && first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert!(first != second);
    }
}
