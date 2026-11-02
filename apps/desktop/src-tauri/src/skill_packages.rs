use crate::remote_wire::{SkillPackage, SkillStage};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};
use tauri::Manager;
const MAX: usize = 10 * 1024 * 1024;

fn unpack(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    if bytes.len() > MAX {
        return Err("skill.package_too_large".into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "skill.invalid_zip")?;
    if zip.len() > 600 {
        return Err("skill.too_many_files".into());
    }
    let mut files = Vec::new();
    let mut names = HashSet::new();
    let mut total = 0;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|_| "skill.invalid_zip")?;
        let name = e.name().to_owned();
        if e.enclosed_name().is_none()
            || name.contains('\\')
            || name.contains(':')
            || name.split('/').any(|x| x == ".." || x == ".")
            || e.unix_mode()
                .map(|m| m & 0o170000 == 0o120000)
                .unwrap_or(false)
        {
            return Err("skill.unsafe_path".into());
        }
        if e.is_dir() || name.starts_with("__MACOSX/") || name.ends_with(".DS_Store") {
            continue;
        }
        if name.split('/').any(|x| x.is_empty()) {
            return Err("skill.unsafe_path".into());
        }
        if !names.insert(name.clone()) {
            return Err("skill.duplicate_path".into());
        }
        let mut data = Vec::new();
        e.by_ref()
            .take((30 * 1024 * 1024 - total + 1) as u64)
            .read_to_end(&mut data)
            .map_err(|_| "skill.read_failed")?;
        total += data.len();
        if total > 30 * 1024 * 1024 || files.len() >= 300 {
            return Err("skill.expanded_too_large".into());
        }
        files.push((name, data));
    }
    let prefix = files
        .first()
        .and_then(|(n, _)| n.split_once('/').map(|(d, _)| format!("{d}/")));
    if let Some(pre) = prefix.filter(|p| files.iter().all(|(n, _)| n.starts_with(p))) {
        for (name, _) in &mut files {
            *name = name[pre.len()..].to_owned();
        }
    }
    if !files.iter().any(|(n, _)| n == "SKILL.md") {
        return Err("skill.missing_manifest".into());
    }
    Ok(files)
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|_| "skill.cache_unavailable")?
        .join("skill-staging"))
}
fn stage(root: &Path, r: SkillPackage) -> Result<String, String> {
    if r.archive.len() > MAX.div_ceil(3) * 4 {
        return Err("skill.package_too_large".into());
    }
    let bytes = STANDARD
        .decode(r.archive)
        .map_err(|_| "skill.invalid_encoding")?;
    if format!("{:x}", Sha256::digest(&bytes)) != r.sha256 {
        return Err("skill.digest_mismatch".into());
    }
    let files = unpack(&bytes)?;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|_| "skill.random_failed")?;
    let dir = root.join(nonce.iter().map(|b| format!("{b:02x}")).collect::<String>());
    std::fs::create_dir_all(&dir).map_err(|_| "skill.storage_failed")?;
    let result = (|| {
        for (name, data) in files {
            let target = dir.join(name);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|_| "skill.storage_failed")?;
            }
            std::fs::write(target, data).map_err(|_| "skill.storage_failed")?;
        }
        Ok(dir.to_string_lossy().to_string())
    })();
    if result.is_err() {
        if let Err(e) = std::fs::remove_dir_all(&dir) {
            log::warn!("skill.cleanup_failed: {e}");
        }
    }
    result
}
#[tauri::command]
pub async fn skill_stage(app: tauri::AppHandle, request: SkillPackage) -> Result<String, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || stage(&root, request))
        .await
        .map_err(|_| "skill.worker_failed")?
}
#[tauri::command]
pub fn skill_stage_remove(app: tauri::AppHandle, request: SkillStage) -> Result<(), String> {
    let root = root(&app)?
        .canonicalize()
        .map_err(|_| "skill.cache_unavailable")?;
    let dir = PathBuf::from(request.path)
        .canonicalize()
        .map_err(|_| "skill.invalid_stage")?;
    if dir.parent() != Some(root.as_path()) {
        return Err("skill.invalid_stage".into());
    }
    std::fs::remove_dir_all(dir).map_err(|_| "skill.cleanup_failed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn zip(name: &str) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        w.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(b"fixture").unwrap();
        w.finish().unwrap().into_inner()
    }
    #[test]
    fn d09_package_boundaries() {
        assert!(unpack(&zip("../SKILL.md")).is_err());
        assert!(unpack(&zip("a\\SKILL.md")).is_err());
        assert!(unpack(&zip("notes.txt")).is_err());
        assert_eq!(unpack(&zip("wrapper/SKILL.md")).unwrap()[0].0, "SKILL.md");
        let root = std::env::temp_dir().join(format!("d09-{}", std::process::id()));
        let bytes = zip("SKILL.md");
        assert!(stage(
            &root,
            SkillPackage {
                archive: STANDARD.encode(&bytes),
                sha256: "bad".into()
            }
        )
        .is_err());
        let p = stage(
            &root,
            SkillPackage {
                archive: STANDARD.encode(&bytes),
                sha256: format!("{:x}", Sha256::digest(&bytes)),
            },
        )
        .unwrap();
        assert_eq!(
            std::fs::read(Path::new(&p).join("SKILL.md")).unwrap(),
            b"fixture"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
