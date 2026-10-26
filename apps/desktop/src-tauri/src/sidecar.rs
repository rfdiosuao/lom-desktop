//! 以 sidecar 方式启动 lom-core（上游二进制名 `aioncore`，ADR 0012）。
//!
//! - 每次启动随机选择本机端口，生成一次性启动令牌（`LOM_LAUNCH_TOKEN`），令牌只在内存与子进程环境变量中。
//! - 传入 `--parent-pid`：外壳异常退出时核心会自行结束；正常退出时外壳主动结束它。
//! - 等 `/health` 返回 200 后才把连接信息交给前端。
//! - Windows 默认不创建可见控制台；设 `LOM_CORE_CONSOLE=1` 可恢复（见下方 creation_flags）。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// 前端拿到的连接信息（字段名与前端 `core/types.ts` 的 `Endpoint` 一致）
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

/// 开发时可用 `LOM_CORE_BIN` 指定核心；打包后核心与主程序放在同一目录（Tauri externalBin）
fn core_binary() -> Result<PathBuf, SidecarError> {
    if let Ok(p) = std::env::var("LOM_CORE_BIN") {
        return Ok(PathBuf::from(p));
    }
    let exe = std::env::current_exe().map_err(|e| err("core.binary_not_found", e))?;
    let dir = exe
        .parent()
        .ok_or_else(|| err("core.binary_not_found", "主程序没有所在目录"))?;
    let name = if cfg!(windows) {
        "aioncore.exe"
    } else {
        "aioncore"
    };
    let path = dir.join(name);
    if path.exists() {
        Ok(path)
    } else {
        Err(err("core.binary_not_found", path.display()))
    }
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
    let default_folder = dirs::document_dir()
        .unwrap_or_else(|| home.join("Documents"))
        .join("Lom");
    let work_dir = data_dir.join("work");
    let log_dir = data_dir.join("logs");
    for d in [data_dir, &work_dir, &log_dir, &default_folder] {
        ensure_dir(d)?;
    }
    let mut command = Command::new(&bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // 控制台子进程默认会获得一个控制台窗口（默认终端里显示为 npm 等标签）。
        // CREATE_NO_WINDOW 让核心及其继承控制台的子进程都不创建可见窗口。
        // 设置 LOM_CORE_CONSOLE=1 可以恢复控制台，便于按日志排查核心问题。
        if std::env::var("LOM_CORE_CONSOLE").as_deref() != Ok("1") {
            command.creation_flags(0x0800_0000);
        }
    }
    let child = command
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
        // 核心的上传临时目录用 Lom 的名字（lom-core 补丁 P4）；Agent 看到的附件路径里不出现上游产品名
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
            log::info!("lom-core ready on port {port}");
            return Ok(sidecar);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    // 尽力结束未就绪的子进程；即使失败，--parent-pid 也会让它在外壳退出时结束
    let _ = sidecar.child.kill();
    Err(err(
        "core.start_timeout",
        format!("40 秒内没有就绪，日志见 {}", log_dir.display()),
    ))
}
