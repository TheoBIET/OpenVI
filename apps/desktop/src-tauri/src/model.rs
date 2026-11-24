//! 3D previews: a model or a whole vehicle exported to GLB in the work folder, loaded by the frontend through the
//! asset protocol (scoped to the app cache) so the GLB's texture files resolve beside it.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use openvi_formats::model::{MaterialReport, VEHICLE_MODELS, material_report, model_glb, vehicle_glb};
use tauri::AppHandle;

use crate::fs::{Located, is_archive, locate};
use crate::progress::Reporter;
use crate::{index, scans};

/// The GLB of the model at `resource` (`<archive>#<offset in hex>`), which must be inside `root`.
fn model(root: &Path, work: &Path, resource: &str) -> Result<PathBuf> {
    let (archive, offset) = resource
        .rsplit_once('#')
        .with_context(|| format!("{resource} is not a resource path"))?;
    let offset = u64::from_str_radix(offset, 16).with_context(|| format!("bad offset in {resource}"))?;
    let Located { path, relative, .. } = locate(root, Path::new(archive))?;
    ensure!(
        path.is_file() && is_archive(&path),
        "{} is not an archive",
        path.display()
    );
    let root = dunce::canonicalize(root)?;
    model_glb(&root, work, &relative, offset)
}

/// The GLB of vehicle `name` in configuration `config`; scans the vehicle models first when needed.
fn vehicle(root: &Path, work: &Path, name: &str, config: usize, reporter: &Reporter) -> Result<PathBuf> {
    let models = root.join(VEHICLE_MODELS);
    if models.is_file() {
        // One scan per archive at a time; vehicle_glb then reads it from the cache.
        scans::scan_reported(&models, VEHICLE_MODELS, &work.join("index"), reporter)?;
    }
    reporter.step(format!("Exporting {name} with its wheels…"));
    vehicle_glb(root, work, name, config, |_, _, _| {})
}

/// The materials of the exported GLB `glb`, which must be an export inside `work`.
fn materials(work: &Path, glb: &Path) -> Result<Vec<MaterialReport>> {
    let work = dunce::canonicalize(work)?;
    let glb = dunce::canonicalize(glb)?;
    ensure!(
        ["models", "vehicles", "characters"]
            .iter()
            .any(|folder| glb.starts_with(work.join(folder))),
        "{} is not a model export",
        glb.display()
    );
    material_report(&glb)
}

/// The materials of an exported model or vehicle, each texture with its status (why one is missing).
#[tauri::command]
pub async fn model_materials(app: AppHandle, glb: PathBuf) -> Result<Vec<MaterialReport>, String> {
    let work = index::work_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || materials(&work, &glb))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// The GLB file of the model resource at `path`, exported into the work folder on first use.
#[tauri::command]
pub async fn model_preview(app: AppHandle, root: PathBuf, path: String) -> Result<PathBuf, String> {
    let work = index::work_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || model(&root, &work, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// The GLB file of vehicle `name` (its model name) in configuration `config`, with its wheels.
#[tauri::command]
pub async fn vehicle_preview(app: AppHandle, root: PathBuf, name: String, config: usize) -> Result<PathBuf, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let reporter = Reporter::new(app);
    tauri::async_runtime::spawn_blocking(move || vehicle(&root, &work, &name, config, &reporter))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use openvi_formats::{fixtures, scan_archive};

    use super::*;

    #[test]
    fn refuses_bad_paths_and_resources_that_are_not_models() {
        let root = std::env::temp_dir().join(format!("openvi-model-app-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("pack")).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(root.join("common.rpf"), bytes).unwrap();
        let work = root.join(".work");
        scan_archive(
            &root.join("common.rpf"),
            "common.rpf",
            &work.join("index"),
            |_, _, _| {},
        )
        .unwrap();
        let archive = root.join("common.rpf").display().to_string();

        let texture = model(&root, &work, &format!("{archive}#{:x}", offsets[4]));
        let outside = model(&root.join("pack"), &work, &format!("{archive}#{:x}", offsets[3]));
        let no_offset = model(&root, &work, &archive);
        let no_vehicles = vehicle(&root, &work, "phoenix", 0, &Reporter::silent());
        std::fs::remove_dir_all(&root).unwrap();

        assert!(texture.unwrap_err().to_string().contains("not a model"));
        let foreign = materials(&root.join(".work"), &root.join("common.rpf"));
        assert!(foreign.is_err());
        assert!(outside.is_err() && no_offset.is_err() && no_vehicles.is_err());
    }
}
