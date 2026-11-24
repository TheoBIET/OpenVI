//! The Characters section: characters and animals, their parts, and one assembled in 3D.

use std::path::{Path, PathBuf};

use anyhow::Result;
use openvi_formats::characters::{
    CHARACTER_PARTS, Character, CharacterPart, character_glb, character_list, character_parts,
};
use tauri::AppHandle;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

fn list(root: &Path, work: &Path, database: &Path, reporter: &Reporter) -> Result<Vec<Character>> {
    scan_all(root, work, database, &[CHARACTER_PARTS], reporter)?;
    reporter.step("Listing the characters and animals…");
    character_list(root, work, |_, _, _| {})
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every character and animal of the game folder `root`; scans `packs.rpf` first when needed (each step as
/// `catalog-progress`).
#[tauri::command]
pub async fn characters(app: AppHandle, root: PathBuf) -> Result<Vec<Character>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    blocking(move || list(&root, &work, &database, &reporter)).await
}

/// The parts character `name` can wear.
#[tauri::command]
pub async fn character_part_list(app: AppHandle, root: PathBuf, name: String) -> Result<Vec<CharacterPart>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || character_parts(&root, &work, &name)).await
}

/// The GLB of character `name` wearing `parts` (offsets), or its default look when `parts` is null; with a clip
/// (`dictionary` and `clip` names) as its animation, on the skeleton alone when `skeleton_only`.
#[tauri::command]
pub async fn character_preview(
    app: AppHandle,
    root: PathBuf,
    name: String,
    parts: Option<Vec<u64>>,
    dictionary: Option<String>,
    clip: Option<String>,
    skeleton_only: Option<bool>,
) -> Result<PathBuf, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let reporter = Reporter::new(app);
    blocking(move || {
        let chosen = dictionary.as_deref().zip(clip.as_deref());
        reporter.step(match chosen {
            Some((_, clip)) => format!("Assembling {name} with {clip}…"),
            None => format!("Assembling {name}…"),
        });
        character_glb(
            &root,
            &work,
            &name,
            parts.as_deref(),
            chosen,
            skeleton_only.unwrap_or(false),
        )
    })
    .await
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
            &Reporter::silent(),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains(CHARACTER_PARTS));
    }
}
