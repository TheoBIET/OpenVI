//! The local index of a game folder: filled by scans, searched by name.

use std::borrow::Cow;
use std::path::{MAIN_SEPARATOR_STR, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

use anyhow::{Context, Result};
use openvi_formats::{ArchiveScan, ScanPhase};
use openvi_index::{Index, Status};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::fs::{Entry, EntryKind};

/// Event sent while [`index_game`] runs.
pub const PROGRESS_EVENT: &str = "index-progress";

/// Most results a search returns.
const SEARCH_LIMIT: usize = 5_000;

/// Set while an indexing pass runs: one at a time.
#[derive(Default)]
pub struct Indexing(Arc<AtomicBool>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    /// The archive being indexed, from the game folder.
    archive: String,
    /// 1-based position of `archive` among `count` archives.
    position: usize,
    count: usize,
    /// `None` while the archive is checked or stored; a phase while it is scanned.
    phase: Option<ScanPhase>,
    done: u64,
    total: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    archives: usize,
    /// Scanned (or read back from the scan cache) and stored.
    indexed: usize,
    /// Already indexed as they are on disk.
    unchanged: usize,
    /// "<archive>: <error>" for each archive that failed.
    failed: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchView {
    /// Resources, each with its archive in `location`.
    entries: Vec<Entry>,
    truncated: bool,
}

/// Where scans are cached.
pub(crate) fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(work_dir(app)?.join("index"))
}

/// SixNG's work folder: scans in `index/`, catalogs in `catalog/`.
pub(crate) fn work_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache = app.path().app_cache_dir().map_err(|error| error.to_string())?;
    Ok(adopt_old_scans(&cache))
}

/// Up to 0.2.1, scans were cached in `<cache>/archives`; they move to `<cache>/work/index` once, so nothing is
/// scanned again. Returns `<cache>/work`.
fn adopt_old_scans(cache: &Path) -> PathBuf {
    let work = cache.join("work");
    let (old, new) = (cache.join("archives"), work.join("index"));
    if old.is_dir() && !new.exists() && std::fs::create_dir_all(&work).is_ok() {
        // On failure the old scans stay where they are and archives are scanned again: no harm done.
        let _ = std::fs::rename(&old, &new);
    }
    work
}

/// The index database of the game folder `root` (canonical): one per folder, in the app data folder.
pub(crate) fn database(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    let data = app.path().app_local_data_dir().map_err(|error| error.to_string())?;
    Ok(database_in(&data, root))
}

fn database_in(data: &Path, root: &Path) -> PathBuf {
    // FNV-1a of the folder path keeps two installs with the same folder name apart.
    let hash = root
        .to_string_lossy()
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
        });
    let name = root
        .file_name()
        .map_or_else(|| "root".into(), |name| name.to_string_lossy());
    data.join("index").join(format!("{name}-{hash:016x}.sqlite"))
}

fn modified_secs(path: &Path) -> Result<(u64, u64)> {
    let metadata = std::fs::metadata(path)?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_secs());
    Ok((metadata.len(), mtime))
}

/// Stores the scan of one archive unless the index already holds it, so opening an archive also fills the index.
pub(crate) fn record(database: &Path, archive: &Path, relative: &str, scan: &ArchiveScan) -> Result<()> {
    let (size, mtime) = modified_secs(archive)?;
    let mut index = Index::open(database)?;
    if !index.is_current(relative, size, mtime)? {
        index.store(relative, size, mtime, scan)?;
    }
    Ok(())
}

/// Every `.rpf` under `root`, as paths from it with forward slashes, sorted.
fn find_archives(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(file_type) = entry.file_type() else { continue };
            if name.starts_with('.') {
                continue;
            }
            let relative = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if file_type.is_dir() {
                walk(&entry.path(), &relative, out);
            } else if file_type.is_file() && crate::fs::is_archive(&entry.path()) {
                out.push(relative);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", &mut out);
    out.sort();
    out
}

fn native(relative: &str) -> String {
    relative.replace('/', MAIN_SEPARATOR_STR)
}

/// Indexes every archive of `root` that changed since it was last indexed.
fn index_all(
    root: &Path,
    database: &Path,
    cache: &Path,
    progress: Arc<dyn Fn(IndexProgress) + Send + Sync>,
) -> Result<IndexReport> {
    let archives = find_archives(root);
    let mut index = Index::open(database)?;
    let mut report = IndexReport {
        archives: archives.len(),
        ..IndexReport::default()
    };
    for (number, relative) in archives.iter().enumerate() {
        let report_step = |phase, done, total| IndexProgress {
            archive: relative.clone(),
            position: number + 1,
            count: archives.len(),
            phase,
            done,
            total,
        };
        progress(report_step(None, 0, 0));
        let path = root.join(native(relative));
        let outcome = (|| -> Result<bool> {
            let (size, mtime) = modified_secs(&path)?;
            if index.is_current(relative, size, mtime)? {
                return Ok(false);
            }
            let scanning = Arc::clone(&progress);
            let (archive, position, count) = (relative.clone(), number + 1, archives.len());
            let scan = crate::scans::scan_exclusive(&path, relative, cache, move |phase, done, total| {
                scanning(IndexProgress {
                    archive: archive.clone(),
                    position,
                    count,
                    phase: Some(phase),
                    done,
                    total,
                });
            })?;
            index.store(relative, size, mtime, &scan)?;
            Ok(true)
        })();
        match outcome {
            Ok(true) => report.indexed += 1,
            Ok(false) => report.unchanged += 1,
            Err(error) => report.failed.push(format!("{relative}: {error:#}")),
        }
    }
    Ok(report)
}

fn search(root: &Path, database: &Path, query: &str) -> Result<SearchView> {
    let results = Index::open(database)?.search(query, SEARCH_LIMIT)?;
    let entries = results
        .hits
        .into_iter()
        .map(|hit| {
            // Same path as the archive listing gives the resource, so the result can be selected there.
            let archive = root.join(native(&hit.archive));
            Entry {
                name: hit.name,
                path: PathBuf::from(format!("{}#{:x}", archive.display(), hit.offset)),
                kind: EntryKind::Resource,
                size: hit.size,
                items: None,
                offset: Some(hit.offset),
                type_name: Some(Cow::Owned(hit.type_name)),
                location: Some(hit.archive),
            }
        })
        .collect();
    Ok(SearchView {
        entries,
        truncated: results.truncated,
    })
}

pub(crate) fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    dunce::canonicalize(root)
        .with_context(|| format!("cannot open {}", root.display()))
        .map_err(|error| format!("{error:#}"))
}

/// Scans every archive of the game folder `root` into its index, reporting progress with [`PROGRESS_EVENT`].
#[tauri::command]
pub async fn index_game(app: AppHandle, state: State<'_, Indexing>, root: PathBuf) -> Result<IndexReport, String> {
    let root = canonical_root(&root)?;
    let database = database(&app, &root)?;
    let cache = cache_dir(&app)?;
    let running = Arc::clone(&state.0);
    if running.swap(true, Ordering::SeqCst) {
        return Err("Indexing is already running".into());
    }
    let progress: Arc<dyn Fn(IndexProgress) + Send + Sync> = Arc::new(move |step| {
        let _ = app.emit(PROGRESS_EVENT, step);
    });
    let result = tauri::async_runtime::spawn_blocking(move || index_all(&root, &database, &cache, progress)).await;
    running.store(false, Ordering::SeqCst);
    result
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Named resources of the game folder `root` whose name contains `query`.
#[tauri::command]
pub async fn search_index(app: AppHandle, root: PathBuf, query: String) -> Result<SearchView, String> {
    let root = canonical_root(&root)?;
    let database = database(&app, &root)?;
    tauri::async_runtime::spawn_blocking(move || search(&root, &database, &query))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// What the index of the game folder `root` holds.
#[tauri::command]
pub async fn index_status(app: AppHandle, root: PathBuf) -> Result<Status, String> {
    let root = canonical_root(&root)?;
    let database = database(&app, &root)?;
    tauri::async_runtime::spawn_blocking(move || Index::open(&database)?.status())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use openvi_formats::fixtures;

    use super::*;

    /// A game folder with two synthetic archives, one in a subfolder, and a plain file.
    fn game_folder(test: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("openvi-index-app-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("pack").join("story000")).unwrap();
        let (bytes, _) = fixtures::archive();
        std::fs::write(root.join("common.rpf"), &bytes).unwrap();
        std::fs::write(root.join("pack").join("story000").join("story000.rpf"), &bytes).unwrap();
        std::fs::write(root.join("eboot.bin"), [0u8; 3]).unwrap();
        dunce::canonicalize(root).unwrap()
    }

    #[test]
    fn indexes_every_archive_once_and_finds_resources_by_name() {
        let root = game_folder("all");
        let work = root.join(".work");
        let database = work.join("index.sqlite");
        let steps = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&steps);
        let progress: Arc<dyn Fn(IndexProgress) + Send + Sync> =
            Arc::new(move |step: IndexProgress| seen.lock().unwrap().push(step.archive));

        let first = index_all(&root, &database, &work.join("cache"), Arc::clone(&progress)).unwrap();
        let second = index_all(&root, &database, &work.join("cache"), progress).unwrap();
        let found = search(&root, &database, fixtures::OBJECT_NAME).unwrap();
        let status = Index::open(&database).unwrap().status().unwrap();
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!((first.archives, first.indexed, first.unchanged), (2, 2, 0));
        assert_eq!((second.indexed, second.unchanged), (0, 2));
        assert!(
            steps
                .lock()
                .unwrap()
                .contains(&"pack/story000/story000.rpf".to_string())
        );
        let locations: Vec<_> = found
            .entries
            .iter()
            .map(|entry| entry.location.as_deref().unwrap())
            .collect();
        assert_eq!(locations, ["common.rpf", "pack/story000/story000.rpf"]);
        assert_eq!(found.entries[0].name, fixtures::OBJECT_NAME);
        assert!(
            found.entries[0]
                .path
                .to_string_lossy()
                .starts_with(&*root.join("common.rpf").to_string_lossy())
        );
        assert_eq!(status.archives, 2);
    }

    #[test]
    fn moves_scans_from_the_old_cache_folder_once() {
        let cache = std::env::temp_dir().join(format!("openvi-cache-move-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&cache);
        std::fs::create_dir_all(cache.join("archives")).unwrap();
        std::fs::write(cache.join("archives").join("common.json"), b"{}").unwrap();

        let work = adopt_old_scans(&cache);
        let again = adopt_old_scans(&cache);
        let moved = work.join("index").join("common.json").is_file();
        let old_gone = !cache.join("archives").exists();
        std::fs::remove_dir_all(&cache).unwrap();

        assert_eq!(work, again);
        assert!(moved && old_gone);
    }

    #[test]
    fn keeps_installs_with_the_same_folder_name_apart() {
        let data = Path::new("data");
        let one = database_in(data, Path::new("/games/GTA VI"));
        let two = database_in(data, Path::new("/other/GTA VI"));
        assert_ne!(one, two);
        assert!(one.file_name().unwrap().to_string_lossy().starts_with("GTA VI-"));
    }
}
