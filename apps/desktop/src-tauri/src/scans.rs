//! One scan per archive at a time: a scan cannot be stopped, so opening an archive again, or indexing it, while it
//! is being scanned waits for that scan and then reads its cache instead of writing the same cache files in parallel.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError, TryLockError};

use anyhow::Result;
use openvi_formats::{ArchiveScan, ScanPhase, scan_archive};

use crate::progress::Reporter;

fn lock_for(archive: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    Arc::clone(locks.entry(archive.to_path_buf()).or_default())
}

/// [`scan_archive`], waiting for any scan of the same archive under way.
pub(crate) fn scan_exclusive(
    path: &Path,
    archive_id: &str,
    cache_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<ArchiveScan> {
    let lock = lock_for(path);
    let _guard = lock.lock().unwrap_or_else(PoisonError::into_inner);
    scan_archive(path, archive_id, cache_dir, progress)
}

/// [`scan_exclusive`] reporting to `reporter`: its steps, and that it waits when another scan of the archive (the
/// Index button, another section) holds it.
pub(crate) fn scan_reported(
    path: &Path,
    archive_id: &'static str,
    cache_dir: &Path,
    reporter: &Reporter,
) -> Result<ArchiveScan> {
    let lock = lock_for(path);
    let _guard = match lock.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(TryLockError::WouldBlock) => {
            reporter.step(format!("Waiting for the scan of {archive_id} started elsewhere…"));
            lock.lock().unwrap_or_else(PoisonError::into_inner)
        }
    };
    reporter.step(format!("Checking {archive_id}…"));
    scan_archive(path, archive_id, cache_dir, reporter.scanning(archive_id))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[test]
    fn scans_of_one_archive_take_turns() {
        let running = Arc::new(AtomicUsize::new(0));
        let overlapped = Arc::new(AtomicUsize::new(0));
        let path = Path::new("same.rpf");
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let (running, overlapped) = (Arc::clone(&running), Arc::clone(&overlapped));
                scope.spawn(move || {
                    let lock = lock_for(path);
                    let _guard = lock.lock().unwrap();
                    if running.fetch_add(1, Ordering::SeqCst) > 0 {
                        overlapped.fetch_add(1, Ordering::SeqCst);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    running.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        assert_eq!(overlapped.load(Ordering::SeqCst), 0);
        assert!(Arc::ptr_eq(&lock_for(path), &lock_for(path)));
        assert!(!Arc::ptr_eq(&lock_for(path), &lock_for(Path::new("other.rpf"))));
    }
}
