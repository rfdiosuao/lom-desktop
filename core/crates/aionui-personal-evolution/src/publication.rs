//! Local materialization. The caller must authorize this assistant's private directory.
use crate::{service::Evolution, state::*};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

impl Evolution {
    /// Publish one managed section, never arbitrary paths or whole-document replacements.
    /// The supplied directory must be private to this scope, not shared with untrusted writers.
    /// Compare against the caller's read snapshot; atomic rename prevents partial documents.
    pub fn publish_document(&self, directory: &Path, target: Target, expected: &str) -> Result<(), EvolutionError> {
        let metadata = fs::symlink_metadata(directory).map_err(|_| EvolutionError::Storage)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(EvolutionError::Conflict);
        }
        let name = match target {
            Target::User => "USER.md",
            Target::Tools => "TOOLS.md",
            Target::WorkMethods => "AGENTS.md",
            Target::SoulAdjustment => "SOUL.md",
        };
        let path = directory.join(name);
        let staging_path = directory.join(format!(".{name}.evolution-pending"));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&staging_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                EvolutionError::Conflict
            } else {
                EvolutionError::Storage
            }
        })?;
        let _staging = Staging(staging_path.clone());
        let metadata = match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && !m.file_type().is_symlink() => Some(m),
            Ok(_) => return Err(EvolutionError::Conflict),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(EvolutionError::Storage),
        };
        let original = if metadata.is_some() {
            fs::read_to_string(&path).map_err(|_| EvolutionError::Storage)?
        } else {
            String::new()
        };
        if original != expected {
            return Err(EvolutionError::Conflict);
        }
        let projected = self.project_document(target, &original)?;
        if projected == original {
            return Ok(());
        }
        if let Some(metadata) = metadata {
            file.set_permissions(metadata.permissions())
                .map_err(|_| EvolutionError::Storage)?;
        }
        file.write_all(projected.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| EvolutionError::Storage)?;
        fs::rename(&staging_path, &path).map_err(|_| EvolutionError::Storage)?;
        fs::File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| EvolutionError::Storage)?;
        Ok(())
    }
}
