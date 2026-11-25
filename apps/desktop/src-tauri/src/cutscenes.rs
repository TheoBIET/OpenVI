//! The Cutscenes section: the story pack's scenes, their cast and props, and a cast member playing one.

use std::path::{Path, PathBuf};

use anyhow::Result;
use openvi_formats::characters::CHARACTER_PARTS;
use openvi_formats::cutscenes::{Cutscene, cutscene_glb, cutscene_list};
use tauri::AppHandle;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

/// The story pack, from the game folder.
const STORY: &str = "pack/story000/story000.rpf";

fn list(root: &Path, work: &Path, database: &Path, reporter: &Reporter) -> Result<Vec<Cutscene>> {
    // packs.rpf names the cast; the story pack holds the scenes.
    scan_all(root, work, database, &[CHARACTER_PARTS, STORY], reporter)?;
    reporter.step("Reading the scenes (the first time takes a few minutes)…");
    Ok(cutscene_list(root, work, |_, _, _| {})?.as_ref().clone())
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every cutscene of the game folder `root`; scans the story pack and `packs.rpf` first when needed.
#[tauri::command]
pub async fn cutscenes(app: AppHandle, root: PathBuf) -> Result<Vec<Cutscene>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    blocking(move || list(&root, &work, &database, &reporter)).await
}

/// The GLB of cast member `handle` playing scene `scene`.
#[tauri::command]
pub async fn cutscene_preview(app: AppHandle, root: PathBuf, scene: String, handle: String) -> Result<PathBuf, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let reporter = Reporter::new(app);
    blocking(move || {
        reporter.step(format!("Assembling {handle} playing {scene}…"));
        cutscene_glb(&root, &work, &scene, &handle)
    })
    .await
}
