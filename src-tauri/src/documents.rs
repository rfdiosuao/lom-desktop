use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{fs::File, io::Read, path::Path};
use tauri_plugin_dialog::DialogExt;
const MAX: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct Document {
    name: String,
    kind: &'static str,
    content: String,
}

fn read_document(path: &Path) -> Result<Document, String> {
    let file = File::open(path).map_err(|_| "无法打开文件")?;
    let meta = file.metadata().map_err(|_| "无法读取文件信息")?;
    if !meta.is_file() || meta.len() > MAX {
        return Err("请选择不超过 5 MB 的普通文件".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取失败")?;
    if bytes.len() as u64 > MAX {
        return Err("文件超过 5 MB".into());
    }
    let name = path
        .file_name()
        .ok_or("无效文件名")?
        .to_string_lossy()
        .into_owned();
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    };
    if let Some(mime) = mime {
        Ok(Document {
            name,
            kind: "image",
            content: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        })
    } else {
        let content = String::from_utf8(bytes)
            .map_err(|_| "仅支持 UTF-8 文本、PNG、JPEG、GIF 或 WebP 图片")?;
        Ok(Document {
            name,
            kind: "text",
            content,
        })
    }
}

// The renderer cannot supply a read path. A native picker grants each individual read.
#[tauri::command]
pub async fn open_document(app: tauri::AppHandle) -> Result<Option<Document>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|_| "无法访问选中的文件")?;
        read_document(&path).map(Some)
    })
    .await
    .map_err(|_| "文件对话框失败")?
}

#[tauri::command]
pub async fn save_document(app: tauri::AppHandle, content: String) -> Result<bool, String> {
    if content.len() as u64 > MAX {
        return Err("文件超过 5 MB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_file_name("document.md")
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|_| "无法访问保存路径")?;
        std::fs::write(path, content).map_err(|_| "保存失败")?;
        Ok(true)
    })
    .await
    .map_err(|_| "保存对话框失败")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_document_bounds_and_content() {
        let dir = std::env::temp_dir().join(format!("desktop-doc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        std::fs::write(&path, "# 本地文档").unwrap();
        let doc = read_document(&path).unwrap();
        assert_eq!(doc.content, "# 本地文档");
        assert_eq!(doc.kind, "text");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\n").unwrap();
        assert_eq!(read_document(&path).unwrap().kind, "image");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_document(&path).is_err());
        File::create(&path).unwrap().set_len(MAX + 1).unwrap();
        assert!(read_document(&path).is_err());
        assert!(read_document(&dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
