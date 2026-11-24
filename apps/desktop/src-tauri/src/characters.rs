//! The Characters section: characters and animals, their parts, and one assembled in 3D.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use openvi_formats::ScanPhase;
use openvi_formats::characters::{
    CHARACTER_PARTS, Character, CharacterPart, character_glb, character_list, character_parts,
};
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

/// Scans the character parts (one scan per archive at a time) and records them in the index.
fn scan_parts(root: &Path, work: &Path, database: &Path, progress: Arc<dyn Fn(ScanPhase, u64, u64) + Send + Sync>) {
    let path = root.join(CHARACTER_PARTS);
    if !path.is_file() {
        return;
    }
    let report = Arc::clone(&progress);
    match scans::scan_exclusive(
        &path,
        CHARACTER_PARTS,
        &work.join("index"),
        move |phase, done, total| {
            report(phase, done, total);
        },
    ) {
        Ok(scan) => {
            if let Err(error) = index::record(database, &path, CHARACTER_PARTS, &scan) {
                eprintln!("could not index {CHARACTER_PARTS}: {error:#}");
            }
        }
        // character_list reports the failure.
        Err(error) => eprintln!("could not scan {CHARACTER_PARTS}: {error:#}"),
    }
}

fn list(
    root: &Path,
    work: &Path,
    database: &Path,
    progress: Arc<dyn Fn(ScanPhase, u64, u64) + Send + Sync>,
) -> Result<Vec<Character>> {
    scan_parts(root, work, database, progress);
    character_list(root, work, |_, _, _| {})
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every character and animal of the game folder `root`; scans `packs.rpf` first when needed (progress as
/// [`crate::catalog::PROGRESS_EVENT`]).
#[tauri::command]
pub async fn characters(app: AppHandle, root: PathBuf) -> Result<Vec<Character>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let progress: Arc<dyn Fn(ScanPhase, u64, u64) + Send + Sync> = Arc::new(move |phase, done, total| {
        let step = ScanStep {
            archive: CHARACTER_PARTS,
            phase,
            done,
            total,
        };
        let _ = app.emit(crate::catalog::PROGRESS_EVENT, step);
    });
    blocking(move || list(&root, &work, &database, progress)).await
}

/// The parts character `name` can wear.
#[tauri::command]
pub async fn character_part_list(app: AppHandle, root: PathBuf, name: String) -> Result<Vec<CharacterPart>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || character_parts(&root, &work, &name)).await
}

/// The GLB of character `name` wearing `parts` (offsets), or its default look when `parts` is null.
#[tauri::command]
pub async fn character_preview(
    app: AppHandle,
    root: PathBuf,
    name: String,
    parts: Option<Vec<u64>>,
) -> Result<PathBuf, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || character_glb(&root, &work, &name, parts.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_nothing_without_the_character_parts() {
        let root = std::env::temp_dir().join(format!("openvi-characters-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = list(
            &root,
            &root.join("work"),
            &root.join("index.sqlite"),
            Arc::new(|_, _, _| {}),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains(CHARACTER_PARTS));
    }
}
