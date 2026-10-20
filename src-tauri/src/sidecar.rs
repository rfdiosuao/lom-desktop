//! 以 sidecar 方式启动 lom-core（运行时另行提供）。
//!
//! - 每次启动随机选择本机端口，生成一次性启动令牌（`LOM_LAUNCH_TOKEN`），令牌只在内存与子进程环境变量中。
//! - 传入 `--parent-pid`：外壳异常退出时核心会自行结束；正常退出时外壳主动结束它。
//! - 等 `/health` 返回 200 后才把连接信息交给前端。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
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

impl Endpoint {
    /// Port of the loopback endpoint. The URL is validated by the desktop shell.
    pub fn port(&self) -> Option<u16> {
        self.url
            .rsplit(':')
            .next()?
            .trim_end_matches('/')
            .parse()
            .ok()
    }
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

pub(crate) fn healthy(port: u16) -> bool {
    let Ok(mut stream) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300))
    else {
        return false;
    };
    // 设置超时失败时继续：最坏情况是这一次探测慢一些，外层仍有 40 秒总时限
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    // Read the status line only; a single read can split the response arbitrarily.
    let mut buf = [0u8; 256];
    let mut filled = 0;
    while filled < buf.len() {
        match stream.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => {
                filled += n;
                if buf[..filled].windows(2).any(|window| window == b"\r\n") {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let head = String::from_utf8_lossy(&buf[..filled]);
    let status = head.lines().next().unwrap_or_default();
    let mut parts = status.split_whitespace();
    let protocol = parts.next().unwrap_or_default();
    let code = parts.next().unwrap_or_default();
    matches!(protocol, "HTTP/1.1" | "HTTP/1.0") && matches!(code, "200" | "204")
}

fn ensure_dir(p: &Path) -> Result<(), SidecarError> {
    std::fs::create_dir_all(p).map_err(|e| err("core.dir_failed", format!("{}: {e}", p.display())))
}

/// 启动核心并等待就绪；`data_dir` 为应用数据目录
pub fn start(
    data_dir: &Path,
    child_slot: &Mutex<Option<Child>>,
    stopping: &AtomicBool,
) -> Result<Endpoint, SidecarError> {
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
    // Registration and spawn share the shutdown lock: Exit cannot miss an in-flight child.
    let mut registered = child_slot
        .lock()
        .map_err(|_| err("core.state_poisoned", "运行时状态不可用"))?;
    if stopping.load(Ordering::SeqCst) {
        return Err(err("core.stopped", "桌面正在关闭"));
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
    *registered = Some(child);
    drop(registered);
    let endpoint = Endpoint {
        url: format!("http://127.0.0.1:{port}"),
        token,
        default_folder: default_folder.to_string_lossy().into_owned(),
        home_dir: home.to_string_lossy().into_owned(),
    };
    let deadline = Instant::now() + Duration::from_secs(40);
    while Instant::now() < deadline {
        if stopping.load(Ordering::SeqCst) {
            let _ = stop_child(child_slot);
            return Err(err("core.stopped", "桌面正在关闭"));
        }
        let mut guard = child_slot
            .lock()
            .map_err(|_| err("core.state_poisoned", "运行时状态不可用"))?;
        let child = guard
            .as_mut()
            .ok_or_else(|| err("core.stopped", "运行时已关闭"))?;
        let status = child.try_wait();
        drop(guard);
        if let Ok(Some(status)) = status {
            return Err(err(
                "core.exited",
                format!("核心启动后退出（{status}），日志见 {}", log_dir.display()),
            ));
        }
        if healthy(port) && !stopping.load(Ordering::SeqCst) {
            return Ok(endpoint);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    // 尽力结束未就绪的子进程；即使失败，--parent-pid 也会让它在外壳退出时结束
    let _ = stop_child(child_slot);
    Err(err(
        "core.start_timeout",
        format!("40 秒内没有就绪，日志见 {}", log_dir.display()),
    ))
}

/// Best effort fallback also used by Drop; normal Exit calls this explicitly.
pub fn stop_child(slot: &Mutex<Option<Child>>) -> Option<ExitStatus> {
    let mut guard = slot.lock().ok()?;
    let mut child = guard.take()?;
    // The child may already have exited; wait still reaps it after a failed kill.
    let _ = child.kill();
    child.wait().ok()
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

    #[test]
    fn endpoint_ports_are_parsed_from_loopback_urls() {
        let endpoint = Endpoint {
            url: "http://127.0.0.1:51234".into(),
            token: String::new(),
            default_folder: String::new(),
            home_dir: String::new(),
        };
        assert_eq!(endpoint.port(), Some(51234));
        assert_eq!(
            Endpoint {
                url: "http://127.0.0.1".into(),
                ..endpoint
            }
            .port(),
            None
        );
    }

    fn health_server(status: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("address").port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accepted connection");
            let mut request = [0u8; 256];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(status.as_bytes());
        });
        port
    }

    #[test]
    fn health_probe_accepts_a_200_status_line() {
        let port = health_server("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        assert!(healthy(port));
    }

    #[test]
    fn health_probe_rejects_non_success_status() {
        let port = health_server("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        assert!(!healthy(port));
    }
}
