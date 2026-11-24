//! The Animations section: the clip dictionaries of `anim.rpf` and their clips. A clip plays on a character through
//! `character_preview`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use openvi_formats::ScanPhase;
use openvi_formats::animations::{ANIMATIONS, Clip, ClipDictionary, clip_dictionaries, clip_list};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{index, scans};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanStep {
    archive: &'static str,
    phase: ScanPhase,
    done: u64,
    total: u64,
}

fn dictionaries(
    root: &Path,
    work: &Path,
    database: &Path,
    progress: Arc<dyn Fn(ScanPhase, u64, u64) + Send + Sync>,
) -> Result<Vec<ClipDictionary>> {
    let path = root.join(ANIMATIONS);
    if path.is_file() {
        // One scan per archive at a time, recorded in the index; clip_dictionaries then reads it from the cache.
        let report = Arc::clone(&progress);
        let scan = scans::scan_exclusive(&path, ANIMATIONS, &work.join("index"), move |phase, done, total| {
            report(phase, done, total);
        })?;
        if let Err(error) = index::record(database, &path, ANIMATIONS, &scan) {
            eprintln!("could not index {ANIMATIONS}: {error:#}");
        }
    }
    clip_dictionaries(root, work, |_, _, _| {})
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every clip dictionary of the game folder `root`; scans `anim.rpf` first when needed (progress as
/// [`crate::catalog::PROGRESS_EVENT`]).
#[tauri::command]
pub async fn animation_dictionaries(app: AppHandle, root: PathBuf) -> Result<Vec<ClipDictionary>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let progress: Arc<dyn Fn(ScanPhase, u64, u64) + Send + Sync> = Arc::new(move |phase, done, total| {
        let step = ScanStep {
            archive: ANIMATIONS,
            phase,
            done,
            total,
        };
        let _ = app.emit(crate::catalog::PROGRESS_EVENT, step);
    });
    blocking(move || dictionaries(&root, &work, &database, progress)).await
}

/// The clips of `dictionary` (its name or id).
#[tauri::command]
pub async fn animation_clips(app: AppHandle, root: PathBuf, dictionary: String) -> Result<Vec<Clip>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || clip_list(&root, &work, &dictionary)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_animation_archive() {
        let root = std::env::temp_dir().join(format!("openvi-animations-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = dictionaries(
            &root,
            &root.join("work"),
            &root.join("index.sqlite"),
            Arc::new(|_, _, _| {}),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains(ANIMATIONS));
    }
}
