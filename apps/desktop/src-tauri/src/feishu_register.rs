//! FEISHU-06：扫一次码就连上飞书。
//!
//! 飞书的“个人智能体”应用注册（与 lark-cli `config init --new` 同一个设备码流程）在用户扫码确认后，
//! 一次返回应用凭据和扫码人的 open_id。lark-cli 只保存凭据、丢掉 open_id，所以要再扫一次“用户授权”才知道主人是谁。
//! 这里由 Lom 自己走注册流程：拿到凭据交给 lark-cli（`config init --app-id … --app-secret-stdin`，密钥走 stdin，
//! 存进系统钥匙串），把主人的 open_id 记在本机配置目录里，收消息时只认这个人。用户权限授权改为可选。

use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::feishu::{command, prompt, replace_child, FeishuPrompt, FeishuState, StepResult};

const REGISTRATION: &str = "/oauth/v1/app/registration";
const OWNER_FILE: &str = "lom-owner.json";
/// 二维码页面带上内置 lark-cli 的版本，和官方命令行发起时一致
const CLI_VERSION: &str = "1.0.97";

fn accounts(brand: &str) -> &'static str {
    if brand == "lark" {
        "https://accounts.larksuite.com"
    } else {
        "https://accounts.feishu.cn"
    }
}

#[derive(Debug, PartialEq)]
pub struct Begin {
    pub device_code: String,
    pub url: String,
    pub interval: u64,
    pub expires_in: u64,
}

pub fn parse_begin(v: &Value) -> Result<Begin, String> {
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        let desc = v
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or(err);
        return Err(format!("feishu.no_qr: {desc}"));
    }
    let field = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default();
    let (device_code, user_code) = (field("device_code"), field("user_code"));
    if device_code.is_empty()
        || user_code.is_empty()
        || !user_code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("feishu.no_qr: registration returned no code".into());
    }
    let num = |k: &str, d: u64| {
        v.get(k)
            .and_then(Value::as_u64)
            .filter(|n| *n > 0)
            .unwrap_or(d)
    };
    Ok(Begin {
        device_code: device_code.to_owned(),
        url: format!("https://open.feishu.cn/page/cli?user_code={user_code}&lpv={CLI_VERSION}&ocv={CLI_VERSION}&from=cli"),
        interval: num("interval", 5).min(60),
        expires_in: num("expire_in", num("expires_in", 600)),
    })
}

#[derive(Debug, PartialEq)]
pub enum Poll {
    Pending,
    SlowDown,
    /// 扫码人在国际版 Lark：换到 Lark 的接口继续轮询
    SwitchBrand(&'static str),
    Done {
        app_id: String,
        secret: String,
        owner: String,
        brand: &'static str,
    },
    Failed(String),
}

pub fn parse_poll(v: &Value, brand: &'static str) -> Poll {
    let user = v.get("user_info");
    let tenant = user
        .and_then(|u| u.get("tenant_brand"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let actual = if tenant == "lark" {
        "lark"
    } else if tenant == "feishu" {
        "feishu"
    } else {
        brand
    };
    if actual != brand {
        return Poll::SwitchBrand(actual);
    }
    match v.get("error").and_then(Value::as_str) {
        Some("authorization_pending") => return Poll::Pending,
        Some("slow_down") => return Poll::SlowDown,
        Some("access_denied") => return Poll::Failed("feishu.denied: access_denied".into()),
        Some("expired_token" | "invalid_grant") => return Poll::Failed("feishu.expired".into()),
        Some(other) => {
            let desc = v
                .get("error_description")
                .and_then(Value::as_str)
                .unwrap_or(other);
            return Poll::Failed(format!("feishu.register_failed: {desc}"));
        }
        None => {}
    }
    let field = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let owner = user
        .and_then(|u| u.get("open_id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let (app_id, secret) = (field("client_id"), field("client_secret"));
    if app_id.is_empty() || secret.is_empty() {
        return Poll::Pending;
    }
    if !owner.starts_with("ou_") {
        return Poll::Failed("feishu.register_failed: no owner in registration result".into());
    }
    Poll::Done {
        app_id,
        secret,
        owner: owner.to_owned(),
        brand,
    }
}

/// 收消息时认定的主人：一次扫码接入时记下的 open_id
pub fn read_owner(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(OWNER_FILE)).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    v.get("open_id")
        .and_then(Value::as_str)
        .filter(|s| s.starts_with("ou_"))
        .map(str::to_owned)
}

pub fn write_owner(dir: &Path, open_id: &str) -> Result<(), String> {
    let path = dir.join(OWNER_FILE);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut f = options
        .open(&path)
        .map_err(|e| format!("feishu.owner_write: {e}"))?;
    f.write_all(
        serde_json::json!({ "open_id": open_id })
            .to_string()
            .as_bytes(),
    )
    .map_err(|e| format!("feishu.owner_write: {e}"))
}

pub fn clear_owner(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(OWNER_FILE));
}

fn post(brand: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    let res = ureq::post(&format!("{}{REGISTRATION}", accounts(brand)))
        .timeout(Duration::from_secs(30))
        .send_form(form);
    let res = match res {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("feishu.network: {e}")),
    };
    res.into_json::<Value>()
        .map_err(|e| format!("feishu.network: {e}"))
}

/// 把注册得到的应用交给 lark-cli（密钥只经 stdin），再记下主人
fn save(dir: &Path, app_id: &str, secret: &str, owner: &str, brand: &str) -> Result<(), String> {
    let mut child = command(
        dir,
        &[
            "config",
            "init",
            "--app-id",
            app_id,
            "--app-secret-stdin",
            "--brand",
            brand,
            "--lang",
            "zh",
        ],
    )?
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("feishu.run_failed: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{secret}\n").as_bytes())
            .map_err(|e| format!("feishu.run_failed: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("feishu.run_failed: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let detail = err
            .lines()
            .rfind(|l| !l.trim().is_empty())
            .unwrap_or_default();
        return Err(format!("feishu.save_failed: {detail}"));
    }
    write_owner(dir, owner)
}

/// 发起一次扫码接入，返回二维码；扫码结果通过 `feishu-connect`（stage = app）通知
#[tauri::command]
pub async fn feishu_connect_begin(
    app: AppHandle,
    state: tauri::State<'_, Arc<FeishuState>>,
    account: String,
    assistant_id: String,
) -> Result<FeishuPrompt, String> {
    let state = state.scoped(&account, &assistant_id)?;
    let dir = crate::feishu_paths::scoped_config_dir(&app, &account, &assistant_id)?;
    let out = command(&dir, &["auth", "status", "--json"])?
        .output()
        .map_err(|_| "feishu.status_failed")?;
    if crate::feishu::parse_status(&String::from_utf8_lossy(&out.stdout)).configured {
        return Err("feishu.already_connected".into());
    }
    let connection_generation = crate::feishu_scope::generation(&state);
    replace_child(&state, None);
    let generation = state.1.load(Ordering::SeqCst);
    let begin = tauri::async_runtime::spawn_blocking(|| {
        post(
            "feishu",
            &[
                ("action", "begin"),
                ("archetype", "PersonalAgent"),
                ("auth_method", "client_secret"),
                ("request_user_info", "open_id tenant_brand"),
            ],
        )
        .and_then(|v| parse_begin(&v))
    })
    .await
    .map_err(|e| format!("feishu.join_failed: {e}"))??;
    let url = begin.url.clone();
    std::thread::spawn(move || {
        let registry = app.state::<Arc<FeishuState>>();
        let Ok(state) = registry.scoped(&account, &assistant_id) else {
            return;
        };
        let current = || state.1.load(Ordering::SeqCst) == generation;
        let deadline = Instant::now() + Duration::from_secs(begin.expires_in);
        let (mut brand, mut interval) = ("feishu", begin.interval);
        let result = loop {
            if Instant::now() >= deadline {
                break Err("feishu.expired".to_owned());
            }
            std::thread::sleep(Duration::from_secs(interval));
            if !current() {
                return; // 取消、重新扫码或断开
            }
            let v = match post(
                brand,
                &[("action", "poll"), ("device_code", &begin.device_code)],
            ) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("feishu: registration poll failed: {e}");
                    interval = (interval + 1).min(60);
                    continue;
                }
            };
            match parse_poll(&v, brand) {
                Poll::Pending => {}
                Poll::SlowDown => interval = (interval + 5).min(60),
                Poll::SwitchBrand(next) => brand = next,
                Poll::Failed(e) => break Err(e),
                Poll::Done {
                    app_id,
                    secret,
                    owner,
                    brand,
                } => {
                    let Ok(_operation) = state.7.lock() else {
                        return;
                    };
                    if !current() {
                        return;
                    }
                    break crate::feishu_paths::claim_app(&app, &account, &assistant_id, &app_id)
                        .and_then(|_| save(&dir, &app_id, &secret, &owner, brand));
                }
            }
        };
        if !current() {
            return;
        }
        let step = StepResult {
            account,
            assistant_id,
            app_id: command(&dir, &["auth", "status", "--json"])
                .and_then(|mut c| c.output().map_err(|_| "feishu.status_failed".to_owned()))
                .ok()
                .and_then(|o| {
                    crate::feishu::parse_status(&String::from_utf8_lossy(&o.stdout)).app_id
                }),
            generation: crate::feishu_scope::generation(&state),
            stage: "app",
            ok: result.is_ok(),
            error: result.err(),
        };
        if let Err(e) = app.emit("feishu-connect", step) {
            log::warn!("feishu: failed to notify the window: {e}");
        }
    });
    let mut result = prompt(url)?;
    result.generation = connection_generation;
    Ok(result)
}

#[cfg(test)]
#[path = "feishu_register_tests.rs"]
mod tests;
