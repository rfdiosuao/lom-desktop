//! D29: bounded, read-only upload catalog. Never resolve duplicate names by precedence.
use crate::{
    error::ExtensionError,
    skill_service::{SkillListItem, SkillSource, parse_frontmatter_fields},
};
use aionui_db::SkillRow;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

pub async fn list(
    rows: Vec<SkillRow>,
    workspace: Option<String>,
) -> Result<(Vec<SkillListItem>, Vec<String>), ExtensionError> {
    let mut roots: Vec<(PathBuf, SkillSource, bool)> = rows
        .into_iter()
        .filter(|r| !r.path.contains("auto-inject"))
        .map(|r| {
            let source = if r.source == "builtin" {
                SkillSource::Builtin
            } else {
                SkillSource::Custom
            };
            (PathBuf::from(r.path), source, true)
        })
        .collect();
    if let Some(workspace) = workspace.filter(|s| !s.is_empty()) {
        let p = Path::new(&workspace);
        if !p.is_absolute() {
            return Err(ExtensionError::InvalidSkillPath("workspace must be absolute".into()));
        }
        let _readable = tokio::fs::read_dir(p).await?;
        for folder in [".agents/skills", ".claude/skills", ".codex/skills", "skills"] {
            roots.push((p.join(folder), SkillSource::Custom, false));
        }
    }
    Ok(scan(roots).await)
}
async fn scan(roots: Vec<(PathBuf, SkillSource, bool)>) -> (Vec<SkillListItem>, Vec<String>) {
    let mut stack: Vec<_> = roots.into_iter().map(|(p, s, required)| (p, s, required, 0)).collect();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut warnings = Vec::new();
    let mut visited = 0;
    while let Some((mut p, source, required, depth)) = stack.pop() {
        visited += 1;
        if visited > 1000 || stack.len() > 1000 {
            warnings.push("skill.scan_limit: 技能目录过多，请缩小工作区".into());
            break;
        }
        if p.file_name().is_some_and(|n| n == "SKILL.md") {
            p.pop();
        }
        let meta = match tokio::fs::symlink_metadata(&p).await {
            Ok(m) => m,
            Err(e) if !required && e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                warnings.push(format!("skill.directory_unreadable: {}", p.display()));
                continue;
            }
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            warnings.push(format!("skill.unsafe_directory: {}", p.display()));
            continue;
        }
        if !seen.insert(p.clone()) {
            continue;
        }
        let manifest = p.join("SKILL.md");
        match tokio::fs::symlink_metadata(&manifest).await {
            Ok(m) if m.is_file() && !m.file_type().is_symlink() && m.len() <= 1024 * 1024 => {
                match tokio::fs::read_to_string(&manifest).await {
                    Ok(text) => {
                        if let Some((name, description)) = parse_frontmatter_fields(&text) {
                            let name = if name.is_empty() {
                                p.file_name().unwrap_or_default().to_string_lossy().into_owned()
                            } else {
                                name
                            };
                            items.push(SkillListItem {
                                name,
                                description,
                                location: p.to_string_lossy().into_owned(),
                                relative_location: None,
                                is_custom: source != SkillSource::Builtin,
                                source,
                            });
                        } else {
                            warnings.push(format!("skill.invalid_manifest: {}", manifest.display()));
                        }
                    }
                    Err(_) => warnings.push(format!("skill.manifest_unreadable: {}", manifest.display())),
                }
            }
            Ok(_) => warnings.push(format!("skill.unsafe_manifest: {}", manifest.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && depth < 4 => match tokio::fs::read_dir(&p).await {
                Ok(mut dir) => loop {
                    match dir.next_entry().await {
                        Ok(Some(entry)) => {
                            if stack.len() >= 1000 {
                                warnings.push("skill.scan_limit".into());
                                break;
                            }
                            if entry.file_type().await.is_ok_and(|t| t.is_dir()) {
                                stack.push((entry.path(), source, true, depth + 1));
                            }
                        }
                        Ok(None) => break,
                        Err(_) => {
                            warnings.push(format!("skill.directory_unreadable: {}", p.display()));
                            break;
                        }
                    }
                },
                Err(_) => warnings.push(format!("skill.directory_unreadable: {}", p.display())),
            },
            Err(_) => warnings.push(format!("skill.manifest_unavailable: {}", manifest.display())),
        }
    }
    (items, warnings)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn d29_disk_names_duplicates_stale_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["a", "b"] {
            let p = dir.path().join(n);
            std::fs::create_dir(&p).unwrap();
            std::fs::write(p.join("SKILL.md"), "---\nname: Same\ndescription: Real\n---\n# Body").unwrap();
        }
        let (items, warnings) = scan(vec![
            (dir.path().to_owned(), SkillSource::Custom, true),
            (dir.path().join("gone"), SkillSource::Custom, true),
        ])
        .await;
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|s| s.name == "Same"));
        assert_ne!(items[0].location, items[1].location);
        assert!(warnings.iter().any(|w| w.contains("directory_unreadable")));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("a"), dir.path().join("link")).unwrap();
            let (items, w) = scan(vec![(dir.path().join("link"), SkillSource::Custom, true)]).await;
            assert!(items.is_empty());
            assert!(w[0].contains("unsafe_directory"));
        }
    }
}
