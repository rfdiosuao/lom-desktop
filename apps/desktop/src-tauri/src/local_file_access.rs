//! Native file grants: renderer paths are requests, never authorization.
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
const MAX: u64 = 100 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(600);
struct Grant {
    file: File,
    size: u64,
    used: Instant,
}
#[derive(Default)]
struct Grants {
    entries: HashMap<String, Grant>,
}
static GRANTS: OnceLock<Mutex<Grants>> = OnceLock::new();
fn grants() -> &'static Mutex<Grants> {
    GRANTS.get_or_init(Mutex::default)
}
fn requested(path: &str) -> Result<(PathBuf, File), String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("file.absolute_path_required".into());
    }
    let canonical = path.canonicalize().map_err(|_| "file.open_failed")?;
    let file = File::open(&canonical).map_err(|_| "file.open_failed")?;
    let meta = file.metadata().map_err(|_| "file.stat_failed")?;
    if !meta.is_file() || meta.len() > MAX {
        return Err("file.invalid_size".into());
    }
    Ok((canonical, file))
}
fn approve(app: &tauri::AppHandle, path: &std::path::Path) -> Result<(), String> {
    if app
        .dialog()
        .message(format!(
            "允许读取并发送此本机文件？\n{path:?}\n仅在你当前要求的任务范围内允许。"
        ))
        .title("麓鸣：本机文件授权")
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show()
    {
        Ok(())
    } else {
        Err("file.access_denied".into())
    }
}
impl Grants {
    fn insert(&mut self, mut file: File) -> Result<(String, String, String), String> {
        self.entries.retain(|_, g| g.used.elapsed() < TTL);
        if self.entries.len() >= 8 {
            return Err("file.too_many_open_grants".into());
        }
        let size = file.metadata().map_err(|_| "file.stat_failed")?.len();
        let mut hash = Sha256::new();
        let mut count = 0u64;
        let mut buf = [0u8; 65536];
        loop {
            let n = file.read(&mut buf).map_err(|_| "file.read_failed")?;
            if n == 0 {
                break;
            }
            count += n as u64;
            if count > MAX {
                return Err("file.too_large".into());
            }
            hash.update(&buf[..n]);
        }
        if count != size {
            return Err("file.changed".into());
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|_| "file.seek_failed")?;
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|_| "file.random_failed")?;
        let ticket = STANDARD.encode(random);
        self.entries.insert(
            ticket.clone(),
            Grant {
                file,
                size,
                used: Instant::now(),
            },
        );
        Ok((size.to_string(), format!("{:x}", hash.finalize()), ticket))
    }
    fn chunk(&mut self, ticket: &str, offset: u64) -> Result<String, String> {
        self.entries.retain(|_, g| g.used.elapsed() < TTL);
        let grant = self.entries.get_mut(ticket).ok_or("file.grant_expired")?;
        if offset > grant.size {
            return Err("file.invalid_offset".into());
        }
        grant
            .file
            .seek(SeekFrom::Start(offset))
            .map_err(|_| "file.seek_failed")?;
        let mut bytes = vec![0; (grant.size - offset).min(128 * 1024) as usize];
        grant
            .file
            .read_exact(&mut bytes)
            .map_err(|_| "file.read_failed")?;
        grant.used = Instant::now();
        Ok(STANDARD.encode(bytes))
    }
}
#[tauri::command]
pub async fn local_file_info(
    app: tauri::AppHandle,
    path: String,
) -> Result<(String, String, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (path, file) = requested(&path)?;
        approve(&app, &path)?;
        grants()
            .lock()
            .map_err(|_| "file.grant_unavailable")?
            .insert(file)
    })
    .await
    .map_err(|_| "file.worker_failed")?
}
#[tauri::command]
pub fn local_file_chunk(ticket: String, offset: u64) -> Result<String, String> {
    grants()
        .lock()
        .map_err(|_| "file.grant_unavailable")?
        .chunk(&ticket, offset)
}
#[tauri::command]
pub fn local_file_release(ticket: String) -> Result<(), String> {
    grants()
        .lock()
        .map_err(|_| "file.grant_unavailable")?
        .entries
        .remove(&ticket);
    Ok(())
}
#[tauri::command]
pub async fn local_image_data(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (path, file) = requested(&path)?;
        approve(&app, &path)?;
        let mut bytes = Vec::new();
        file.take(15 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "image.read_failed")?;
        if bytes.is_empty() || bytes.len() > 15 * 1024 * 1024 {
            return Err("image.invalid_size".into());
        }
        let mime = crate::vision::mime(&bytes).ok_or("image.unsupported_format")?;
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    })
    .await
    .map_err(|_| "file.worker_failed")?
}
#[tauri::command]
pub async fn local_file_save(
    app: tauri::AppHandle,
    name: String,
    data: String,
    sha256: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Renderer supplies only a suggested basename. Destination comes exclusively from native UI.
        let name = name
            .rsplit(['/', '\\'])
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or("attachment");
        let Some(chosen) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(false);
        };
        let path = chosen.into_path().map_err(|_| "file.invalid_destination")?;
        crate::local_files::local_file_save(path.to_string_lossy().into(), data, sha256)?;
        Ok(true)
    })
    .await
    .map_err(|_| "file.worker_failed")?
}
#[cfg(test)]
#[path = "../tests/security/local_file_access.rs"]
mod tests;
