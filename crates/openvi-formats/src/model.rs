//! 3D models as glTF binaries (GLB), exported by SixNG into the work folder for the model view.
//!
//! A GLB references its textures as PNG files beside it, so callers load it from disk (not from memory) for the
//! relative paths to resolve. Exports are kept: opening a model again reads the files already there.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sixng_core::export::{ExportOptions, Workspace, export_many};
use sixng_core::{classify, vehexport, vehicles};

use crate::{ScanPhase, scan_archive};

/// The archive holding the vehicle models.
pub const VEHICLE_MODELS: &str = "levels.rpf";

/// Export options: PNG textures (textures embedded in models included), nothing else.
fn options(out: &Path, force: bool) -> Result<ExportOptions> {
    Ok(serde_json::from_value(json!({
        "out": out, "png": true, "dds": false, "raw": false, "force": force,
        "skip_embedded_textures": false, "body_shape": [],
    }))?)
}

/// Whether the resource at `offset` is a model SixNG exports to GLB.
fn is_model(entry: &sixng_core::scan::Entry) -> bool {
    matches!(entry.kind, classify::Kind::Resource | classify::Kind::RageObj)
        && matches!(entry.rtype.as_deref(), Some("dr" | "ft" | "dd"))
}

/// The model at `offset` in the archive `archive_id` (already scanned into `<work>/index`), as a GLB file.
pub fn model_glb(game_root: &Path, work_dir: &Path, archive_id: &str, offset: u64) -> Result<PathBuf> {
    let workspace = Workspace::new(game_root, work_dir);
    let archive = workspace.resolve(archive_id)?;
    let index = workspace.load_index(&archive)?;
    let entry = index
        .entries
        .iter()
        .find(|entry| entry.off == offset)
        .with_context(|| format!("no resource at {offset:#x} in {archive_id}"))?;
    anyhow::ensure!(is_model(entry), "the resource at {offset:#x} is not a model");

    let out = work_dir.join("models");
    // An earlier export is reused ("skipped" lists no files); export again only when its files cannot be found.
    for force in [false, true] {
        let items = export_many(&archive, &[entry], &options(&out, force)?, Arc::new(|_, _, _| {}))?;
        let item = items.first().context("the export returned nothing")?;
        if let Some(error) = &item.error {
            bail!("SixNG could not export this model: {error}");
        }
        if let Some(file) = item.files.iter().find(|file| file.ends_with("model.glb")) {
            return Ok(out.join(file));
        }
        if item.status != "skipped" {
            bail!("SixNG exported no mesh for this model (status {})", item.status);
        }
    }
    bail!("SixNG exported no mesh for this model")
}

/// Vehicle `model` (its model name, as in the vehicle catalog) in configuration `config`, wheels fitted, as a GLB file.
///
/// Scans `levels.rpf` first if needed (`progress`), and builds the vehicle tables if the catalog was not built yet.
pub fn vehicle_glb(
    game_root: &Path,
    work_dir: &Path,
    model: &str,
    config: usize,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<PathBuf> {
    let model = model.to_ascii_lowercase();
    let out = work_dir
        .join("vehicles")
        .join(format!("{model}_{config}"))
        .join(format!("{model}.glb"));
    if out.is_file() {
        return Ok(out);
    }

    let workspace = Workspace::new(game_root, work_dir);
    let catalog = work_dir.join("catalog");
    let tables = catalog.join("vehicles").join("vehicles.json");
    if !tables.is_file() {
        vehicles::build(&workspace, &catalog)?;
    }
    let all: Value = serde_json::from_slice(&std::fs::read(&tables)?)?;
    let vehicle = all["vehicles"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|v| {
            v["model"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(&model))
        })
        .with_context(|| format!("no vehicle named {model} in the vehicle tables"))?;

    let models = game_root.join(VEHICLE_MODELS);
    anyhow::ensure!(models.is_file(), "{} has no {VEHICLE_MODELS}", game_root.display());
    scan_archive(&models, VEHICLE_MODELS, &workspace.index_dir(), progress)?;
    let archive = workspace.resolve(VEHICLE_MODELS)?;
    let index = workspace.load_index(&archive)?;
    let parent = out.parent().context("vehicle export path has no folder")?;
    vehexport::export_vehicle(
        &archive,
        &index,
        vehicle,
        config,
        &[],
        &[],
        true,
        &out,
        &options(parent, true)?,
    )?;
    anyhow::ensure!(out.is_file(), "SixNG exported no GLB for {model}");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    /// A game folder holding the synthetic archive as `common.rpf`, scanned into `<work>/index`.
    fn game(test: &str) -> (PathBuf, Vec<u64>) {
        let root = std::env::temp_dir().join(format!("openvi-model-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(root.join("common.rpf"), bytes).unwrap();
        scan_archive(
            &root.join("common.rpf"),
            "common.rpf",
            &root.join("work").join("index"),
            |_, _, _| {},
        )
        .unwrap();
        (root, offsets)
    }

    #[test]
    fn exports_only_models_that_are_there() {
        let (root, offsets) = game("refuse");
        let work = root.join("work");
        let texture = model_glb(&root, &work, "common.rpf", offsets[4]);
        let nothing = model_glb(&root, &work, "common.rpf", 0x42);
        let unscanned = model_glb(&root, &work, "levels.rpf", offsets[3]);
        std::fs::remove_dir_all(&root).unwrap();

        assert!(texture.unwrap_err().to_string().contains("not a model"));
        assert!(nothing.unwrap_err().to_string().contains("no resource"));
        assert!(unscanned.is_err());
    }

    #[test]
    fn a_synthetic_fragment_has_no_mesh_to_export() {
        // The synthetic fragment is a name and nothing else: the export must fail cleanly, not panic.
        let (root, offsets) = game("empty");
        let result = model_glb(&root, &root.join("work"), "common.rpf", offsets[3]);
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.is_err());
    }

    #[test]
    fn needs_the_vehicle_models() {
        let (root, _) = game("vehicle");
        let result = vehicle_glb(&root, &root.join("work"), "phoenix", 0, |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.is_err());
    }
}
