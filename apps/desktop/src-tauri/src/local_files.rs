//! Bounded reads for user-selected attachment paths; encrypted transport is handled by remote RPC.
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};

/// Validate image headers before exposing the existing bounded file transport to Agents.
#[tauri::command]
pub fn local_image_data(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err("image.absolute_path_required".into());
    }
    if !std::fs::metadata(p)
        .map_err(|_| "image.stat_failed")?
        .is_file()
    {
        return Err("image.not_regular_file".into());
    }
    let file = std::fs::File::open(p).map_err(|_| "image.open_failed")?;
    let meta = file.metadata().map_err(|_| "image.stat_failed")?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > 15 * 1024 * 1024 {
        return Err("image.invalid_size".into());
    }
    let mut bytes = Vec::new();
    file.take(15 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "image.read_failed")?;
    if bytes.is_empty() || bytes.len() > 15 * 1024 * 1024 {
        return Err("image.invalid_size".into());
    }
    let mime = crate::vision::mime(&bytes).ok_or("image.unsupported_format")?;
    let ext = p
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let expected = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("image.unsupported_extension".into()),
    };
    if mime != expected {
        return Err("image.extension_mismatch".into());
    }
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

const MAX: u64 = 100 * 1024 * 1024;
#[tauri::command]
pub fn local_file_info(path: String) -> Result<(String, String), String> {
    let mut file = std::fs::File::open(path).map_err(|_| "file.open_failed")?;
    let meta = file.metadata().map_err(|_| "file.stat_failed")?;
    if !meta.is_file() || meta.len() > MAX {
        return Err("file.too_large".into());
    }
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|_| "file.read_failed")?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok((meta.len().to_string(), format!("{:x}", hash.finalize())))
}
#[tauri::command]
pub fn local_file_chunk(path: String, offset: u64) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "file.open_failed")?;
    let meta = file.metadata().map_err(|_| "file.stat_failed")?;
    if !meta.is_file() || meta.len() > MAX || offset > meta.len() {
        return Err("file.invalid_size".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| "file.seek_failed")?;
    let mut bytes = vec![0u8; (meta.len() - offset).min(128 * 1024) as usize];
    file.read_exact(&mut bytes)
        .map_err(|_| "file.read_failed")?;
    Ok(STANDARD.encode(bytes))
}
#[tauri::command]
pub fn local_file_save(path: String, data: String, sha256: String) -> Result<(), String> {
    if data.len() > (MAX.div_ceil(3) * 4) as usize {
        return Err("file.too_large".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "file.invalid_base64")?;
    if format!("{:x}", Sha256::digest(&bytes)) != sha256 {
        return Err("file.integrity_failed".into());
    }
    // The save dialog selected this destination. Create a sibling temporary file first.
    let destination = std::path::PathBuf::from(path);
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "file.random_failed")?;
    let suffix: String = random.iter().map(|v| format!("{v:02x}")).collect();
    let tmp = destination.with_extension(format!("lom-{suffix}.part"));
    let result = (|| {
        let mut f = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp)
            .map_err(|_| "file.save_failed")?;
        f.write_all(&bytes).map_err(|_| "file.save_failed")?;
        f.sync_all().map_err(|_| "file.save_failed")?;
        std::fs::rename(&tmp, &destination).map_err(|_| "file.save_failed")
    })();
    if result.is_err() {
        let _cleanup = std::fs::remove_file(&tmp);
    }
    result.map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn r02_02_local_file_roundtrip_and_integrity_guard() {
        let root = std::env::temp_dir().join(format!("lom-file-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("attachment.txt");
        let text = "附件 test".as_bytes();
        let hash = format!("{:x}", Sha256::digest(text));
        local_file_save(
            path.to_string_lossy().into(),
            STANDARD.encode(text),
            hash.clone(),
        )
        .unwrap();
        assert_eq!(
            local_file_info(path.to_string_lossy().into()).unwrap(),
            (text.len().to_string(), hash)
        );
        assert_eq!(
            local_file_chunk(path.to_string_lossy().into(), 0).unwrap(),
            STANDARD.encode(text)
        );
        assert!(local_file_chunk(path.to_string_lossy().into(), 1000).is_err());
        assert!(local_file_save(
            path.to_string_lossy().into(),
            STANDARD.encode("bad"),
            "wrong".into()
        )
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), text);
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// Creates only the engine's per-workspace memory directory, never an arbitrary caller path.
#[tauri::command]
pub fn prepare_memory_directory(workspace: String) -> Result<String, String> {
    let root = dirs::config_dir()
        .ok_or("memory.config_dir_unavailable")?
        .join("aionrs");
    prepare_memory_at(&root, &workspace).map(|p| p.to_string_lossy().into_owned())
}

fn prepare_memory_at(
    root: &std::path::Path,
    workspace: &str,
) -> Result<std::path::PathBuf, String> {
    if !std::path::Path::new(workspace).is_absolute() {
        return Err("memory.invalid_workspace".into());
    }
    let name: String = workspace
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if name.len() > 200 {
        return Err("memory.workspace_too_long".into());
    }
    let dir = root.join("projects").join(name).join("memory");
    std::fs::create_dir_all(&dir).map_err(|e| format!("memory.create_failed: {e}"))?;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join("MEMORY.md"))
    {
        Ok(mut file) => file
            .write_all(b"# Memory Index\n")
            .map_err(|e| format!("memory.index_failed: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("memory.index_failed: {e}")),
    }
    Ok(dir)
}

#[cfg(test)]
mod memory_tests {
    #[test]
    fn first_memory_creates_parents_and_preserves_existing_files() {
        let root = std::env::temp_dir().join(format!("lom-memory-{}", std::process::id()));
        let dir = super::prepare_memory_at(&root, "/work/new").unwrap();
        std::fs::write(dir.join("existing.md"), "keep").unwrap();
        assert_eq!(super::prepare_memory_at(&root, "/work/new").unwrap(), dir);
        assert_eq!(
            std::fs::read_to_string(dir.join("existing.md")).unwrap(),
            "keep"
        );
        assert!(super::prepare_memory_at(&root, "../elsewhere").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod image_tests {
    #[test]
    fn phone_image_validates_headers_extension_and_file_kind() {
        let dir = std::env::temp_dir().join(format!("lom-image-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("image.png");
        std::fs::write(&png, b"\x89PNG\r\n\x1a\n0000").unwrap();
        assert_eq!(
            super::local_image_data(png.to_string_lossy().into()),
            Ok("data:image/png;base64,iVBORw0KGgowMDAw".into())
        );
        let fake = dir.join("fake.png");
        std::fs::write(&fake, b"not an image").unwrap();
        assert!(super::local_image_data(fake.to_string_lossy().into()).is_err());
        let mismatch = dir.join("fake.jpg");
        std::fs::write(&mismatch, b"\x89PNG\r\n\x1a\n0000").unwrap();
        assert!(super::local_image_data(mismatch.to_string_lossy().into()).is_err());
        assert!(super::local_image_data("relative.png".into()).is_err());
        assert!(super::local_image_data(dir.to_string_lossy().into()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
