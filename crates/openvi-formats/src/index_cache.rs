//! Scan indexes kept in memory. An index is a JSON file of every resource of an archive (hundreds of MB for
//! `levels.rpf`); reading it again for each resource opened, model previewed or character assembled made those
//! seconds slower each. It is parsed once and kept until its file changes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::SystemTime;

use anyhow::{Context, Result, ensure};
use sixng_core::scan::{self, ArchiveIndex};

/// An index file's state: its length and modification time.
type Stamp = (u64, Option<SystemTime>);

/// Index file -> its state when parsed, and the parsed index.
type Cache = Mutex<HashMap<PathBuf, (Stamp, Arc<ArchiveIndex>)>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Mutex::default)
}

/// The scan index of `archive_id` in `index_dir`, parsed once and reused until its file changes.
pub fn load(index_dir: &Path, archive_id: &str) -> Result<Arc<ArchiveIndex>> {
    let path = scan::index_path(index_dir, archive_id);
    let metadata = std::fs::metadata(&path).with_context(|| format!("{archive_id} has not been scanned yet"))?;
    let stamp = (metadata.len(), metadata.modified().ok());
    if let Some((cached, index)) = cache().lock().unwrap_or_else(PoisonError::into_inner).get(&path)
        && *cached == stamp
    {
        return Ok(Arc::clone(index));
    }
    // Parsed outside the lock: other archives' indexes stay available meanwhile.
    let index = scan::load_index(&path).with_context(|| format!("cannot read the scan of {archive_id}"))?;
    ensure!(
        index.tool_version == sixng_core::INDEX_VERSION,
        "the scan of {archive_id} is from another version; it is redone on the next opening"
    );
    let index = Arc::new(index);
    cache()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(path, (stamp, Arc::clone(&index)));
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{fixtures, scan_archive};

    #[test]
    fn reuses_an_index_until_its_file_changes() {
        let dir = std::env::temp_dir().join(format!("openvi-index-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("common.rpf"), fixtures::archive().0).unwrap();
        let cache = dir.join("cache");
        scan_archive(&dir.join("common.rpf"), "common.rpf", &cache, |_, _, _| {}).unwrap();

        let first = load(&cache, "common.rpf").unwrap();
        let again = load(&cache, "common.rpf").unwrap();
        // A rewritten index (another scan) is read again.
        let mut changed = (*first).clone();
        changed.entries.truncate(1);
        scan::save_index(&cache, &changed).unwrap();
        let reread = load(&cache, "common.rpf").unwrap();
        let missing = load(&cache, "levels.rpf");
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(reread.entries.len(), 1);
        assert!(missing.is_err());
    }
}
