//! The Map section: every entity the map files place, for a top-down view.

use std::path::PathBuf;

use anyhow::Result;
use openvi_formats::map::{Interior, MAP_ARCHIVE, MapSummary, map_index};
use serde::Serialize;
use tauri::AppHandle;
use tauri::ipc::Response;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

/// The map index's summary, its model names (an entity's model is an index into them) and the interiors it places.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapInfo {
    summary: MapSummary,
    models: Vec<String>,
    interiors: Vec<Interior>,
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// The map of the game folder `root`; the first call scans `levels.rpf` if needed and reads every map file (each
/// step as `catalog-progress`).
#[tauri::command]
pub async fn map_info(app: AppHandle, root: PathBuf) -> Result<MapInfo, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    blocking(move || {
        scan_all(&root, &work, &database, &[MAP_ARCHIVE], &reporter)?;
        let counting = reporter.clone();
        let index = map_index(
            &root,
            &work,
            |_, _, _| {},
            move |done, total| {
                counting.count("Reading the map files", done, total);
            },
        )?;
        Ok(MapInfo {
            summary: index.summary(),
            models: index.models.clone(),
            interiors: index.interiors.clone(),
        })
    })
    .await
}

/// The map's entities as bytes, 16 each: x, y, z (f32, metres, RAGE world space) and the model index (u32).
#[tauri::command]
pub async fn map_points(app: AppHandle, root: PathBuf) -> Result<Response, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || {
        Ok(Response::new(
            map_index(&root, &work, |_, _, _| {}, |_, _| {})?.points(),
        ))
    })
    .await
}
