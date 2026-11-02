//! Durable, bounded display cache. Does not call any model or bill the account.
use crate::remote_wire::{ImageCacheKey, ImageCacheWrite};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use tauri::Manager;
const MAX: usize = 15 * 1024 * 1024;

fn mime(b: &[u8]) -> Result<&'static str, String> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if b.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if b.len() >= 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" {
        Ok("image/webp")
    } else {
        Err("image.unsupported: 只支持 PNG、JPEG、GIF、WebP".into())
    }
}
fn path(root: &Path, key: &str) -> Result<PathBuf, String> {
    if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("image.invalid_key".into());
    }
    Ok(root.join(key))
}
fn read(root: &Path, key: &str) -> Result<Option<String>, String> {
    let p = path(root, key)?;
    let file = match std::fs::File::open(p) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("image.cache_read_failed".into()),
    };
    let mut bytes = Vec::new();
    file.take((MAX + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "image.cache_read_failed")?;
    if bytes.len() > MAX {
        return Err("image.too_large".into());
    }
    Ok(Some(format!(
        "data:{};base64,{}",
        mime(&bytes)?,
        STANDARD.encode(bytes)
    )))
}
fn store(root: &Path, key: &str, data: &str) -> Result<(), String> {
    let p = path(root, key)?;
    if data.len() > MAX.div_ceil(3) * 4 + 64 {
        return Err("image.too_large: 单张图片最大 15 MB".into());
    }
    let (head, body) = data.split_once(",").ok_or("image.invalid_data")?;
    let bytes = STANDARD.decode(body).map_err(|_| "image.invalid_data")?;
    if bytes.len() > MAX || head != format!("data:{};base64", mime(&bytes)?) {
        return Err("image.invalid_data".into());
    }
    std::fs::create_dir_all(root).map_err(|_| "image.cache_write_failed")?;
    let tmp = p.with_extension("part");
    std::fs::write(&tmp, bytes).map_err(|_| "image.cache_write_failed")?;
    std::fs::rename(tmp, p).map_err(|_| "image.cache_write_failed".into())
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "image.cache_unavailable")?
        .join("reply-images"))
}
#[tauri::command]
pub fn reply_image_read(
    app: tauri::AppHandle,
    request: ImageCacheKey,
) -> Result<Option<String>, String> {
    read(&root(&app)?, &request.key)
}
#[tauri::command]
pub fn reply_image_store(app: tauri::AppHandle, request: ImageCacheWrite) -> Result<(), String> {
    store(&root(&app)?, &request.key, &request.data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn d08_cache_survives_reload_and_rejects_paths_and_fake_images() {
        let root = std::env::temp_dir().join(format!("lom-image-test-{}", std::process::id()));
        let key = "a".repeat(64);
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")
        );
        store(&root, &key, &data).unwrap();
        assert_eq!(read(&root, &key).unwrap(), Some(data));
        assert!(store(&root, "../bad", "").is_err());
        assert!(store(&root, &key, "data:image/png;base64,PHNjcmlwdD4=").is_err());
        assert!(read(&root, &"b".repeat(64)).unwrap().is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn generated_image(root: &Path, source: &str) -> Result<String, String> {
    let root = root.canonicalize().map_err(|_| "图片生成目录不存在")?;
    let path = Path::new(source)
        .canonicalize()
        .map_err(|_| "图片不存在或已被移走")?;
    if !path.starts_with(root) {
        return Err("不允许读取此图片目录".into());
    }
    let file = std::fs::File::open(path).map_err(|_| "无法读取图片")?;
    let mut bytes = Vec::new();
    file.take((MAX + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取图片")?;
    if bytes.len() > MAX {
        return Err("图片超过 15 MB".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        mime(&bytes)?,
        STANDARD.encode(bytes)
    ))
}
#[tauri::command]
pub fn reply_image_generated(source: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法读取图片目录")?;
    generated_image(&home.join(".codex/generated_images"), &source)
}
#[tauri::command]
pub fn reply_image_copy(width: usize, height: usize, rgba: String) -> Result<(), String> {
    let pixels = width
        .checked_mul(height)
        .filter(|n| *n > 0 && *n <= 16_000_000)
        .ok_or("图片尺寸超限")?;
    if rgba.len() > pixels * 4 * 4 / 3 + 4 {
        return Err("图片数据超限".into());
    }
    let bytes = STANDARD.decode(rgba).map_err(|_| "图片数据无效")?;
    if bytes.len() != pixels * 4 {
        return Err("图片数据不完整".into());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|_| "无法打开系统剪贴板")?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(bytes),
        })
        .map_err(|_| "复制图片失败".into())
}

#[cfg(test)]
mod generated_tests {
    use super::*;
    #[test]
    fn d11_generated_image_rejects_escape_and_loads_real_png() {
        let root = std::env::temp_dir().join(format!("lom-d11-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("dog.png");
        std::fs::write(&file, b"\x89PNG\r\n\x1a\nfixture").unwrap();
        assert!(generated_image(&root, file.to_str().unwrap())
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(generated_image(&root, "/etc/hosts").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hosts", root.join("escape.png")).unwrap();
            assert!(generated_image(&root, root.join("escape.png").to_str().unwrap()).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn d11_clipboard_rejects_bad_dimensions_before_touching_clipboard() {
        assert!(reply_image_copy(0, 10, String::new()).is_err());
        assert!(reply_image_copy(usize::MAX, 2, String::new()).is_err());
        assert!(reply_image_copy(1, 1, "YQ==".into()).is_err());
    }
}

#[cfg(test)]
mod manual_tests {
    use super::*;
    use sha2::{Digest, Sha256};
    #[test]
    #[ignore = "requires an explicit local generated-image path"]
    fn d11_actual_generated_file_download_roundtrip() {
        let source = std::env::var("LOM_D11_IMAGE").unwrap();
        let data = reply_image_generated(source.clone()).unwrap();
        let bytes = STANDARD.decode(data.split_once(',').unwrap().1).unwrap();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let target =
            std::env::temp_dir().join(format!("lom-d11-download-{}.png", std::process::id()));
        crate::local_files::local_file_save(
            target.to_string_lossy().into(),
            STANDARD.encode(&bytes),
            hash.clone(),
        )
        .unwrap();
        assert_eq!(
            crate::local_files::local_file_info(target.to_string_lossy().into())
                .unwrap()
                .1,
            hash
        );
        assert_eq!(crate::local_files::local_file_info(source).unwrap().1, hash);
        std::fs::remove_file(target).unwrap();
    }
    #[test]
    #[ignore = "manual desktop clipboard probe; restores previous image or text"]
    fn d11_native_clipboard_pixel_roundtrip() {
        let mut clipboard = arboard::Clipboard::new().unwrap();
        let old_image = clipboard.get_image().ok().map(|i| arboard::ImageData {
            width: i.width,
            height: i.height,
            bytes: std::borrow::Cow::Owned(i.bytes.into_owned()),
        });
        let old_text = clipboard.get_text().ok();
        assert!(
            old_image.is_some() || old_text.is_some(),
            "Existing clipboard cannot be safely restored"
        );
        let pixels = [255u8, 0, 0, 255, 0, 255, 0, 255];
        let write = reply_image_copy(2, 1, STANDARD.encode(pixels));
        let copied = clipboard.get_image();
        if let Some(image) = old_image {
            clipboard.set_image(image).unwrap();
        } else if let Some(text) = old_text {
            clipboard.set_text(text).unwrap();
        }
        write.unwrap();
        let image = copied.unwrap();
        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.bytes.as_ref(), &pixels);
    }
}
