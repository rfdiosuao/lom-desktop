//! Durable, content-free reservations must complete before any external delivery.
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io;
use std::path::Path;

pub(super) fn reserve(dir: &Path, call_id: &str) -> Result<(), String> {
    reserve_with_sync(dir, call_id, sync_directory)
}

fn reserve_with_sync(
    dir: &Path,
    call_id: &str,
    mut sync: impl FnMut(&Path) -> io::Result<()>,
) -> Result<(), String> {
    let key = format!("{:x}", Sha256::digest(call_id.as_bytes()));
    let receipts = dir.join("delivery-receipts");
    fs::create_dir_all(&receipts).map_err(|_| "feishu.receipt_failed")?;
    let marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(receipts.join(key))
        .map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                "feishu.outcome_unknown"
            } else {
                "feishu.receipt_failed"
            }
        })?;
    marker.sync_all().map_err(|_| "feishu.receipt_failed")?;
    // Persist both names: the receipt directory in its parent, then the marker in that directory.
    // This is required even when the directory already exists after an interrupted attempt.
    sync(dir).map_err(|_| "feishu.receipt_failed")?;
    sync(&receipts).map_err(|_| "feishu.receipt_failed")?;
    // Retain the marker on every failure: a later replay must remain conservative.
    Ok(())
}

#[cfg(not(windows))]
fn sync_directory(path: &Path) -> io::Result<()> {
    fs::File::open(path)?.sync_all()
}

#[cfg(windows)]
fn sync_directory(path: &Path) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    // A directory handle requires BACKUP_SEMANTICS; FlushFileBuffers needs write access.
    // Filesystems that reject directory flushing fail closed before the external CLI runs.
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?
        .sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("lom-receipt-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn feishu_delivery_01_directory_flush_failure_prevents_submission_and_replay() {
        for fail_at in 0..2 {
            let dir = temp(&format!("failed-{fail_at}"));
            let mut submitted = false;
            let mut step = 0;
            let result = reserve_with_sync(&dir, "call", |_| {
                let current = step;
                step += 1;
                if current == fail_at {
                    Err(io::Error::other("injected directory flush failure"))
                } else {
                    Ok(())
                }
            })
            .map(|()| submitted = true);
            assert_eq!(result, Err("feishu.receipt_failed".into()));
            assert!(!submitted);
            assert_eq!(reserve(&dir, "call"), Err("feishu.outcome_unknown".into()));
            fs::remove_dir_all(dir).unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn feishu_delivery_01_fresh_receipt_directory_and_marker_are_durable_before_submission() {
        let dir = temp("fresh");
        let mut flushed = Vec::new();
        reserve_with_sync(&dir, "call", |path| {
            flushed.push(path.to_owned());
            sync_directory(path)
        })
        .unwrap();
        assert_eq!(flushed, [dir.clone(), dir.join("delivery-receipts")]);
        assert_eq!(reserve(&dir, "call"), Err("feishu.outcome_unknown".into()));
        reserve(&dir, "another-call").unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
