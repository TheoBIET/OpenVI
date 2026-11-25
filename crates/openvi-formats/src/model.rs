//! 3D models as glTF binaries (GLB), exported by SixNG into the work folder for the model view.
//!
//! A GLB references its textures as PNG files beside it, so callers load it from disk (not from memory) for the
//! relative paths to resolve. Exports are kept: opening a model again reads the files already there.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use serde::Serialize;
use serde_json::{Value, json};
use sixng_core::export::{ExportOptions, Workspace, export_many};
use sixng_core::{classify, vehexport, vehicles};

use crate::{ScanPhase, scan_archive};

/// The archive holding the vehicle models.
pub const VEHICLE_MODELS: &str = "levels.rpf";

/// The state of the file at `path` on disk, as a folder name: its size and modification time in hex. Exports go
/// under it, so an archive that changes (a download finishing, a game update) gets fresh exports instead of stale ones.
pub(crate) fn version(path: &Path) -> String {
    let Ok(metadata) = std::fs::metadata(path) else {
        return "missing".into();
    };
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_secs());
    format!("{:x}-{mtime:x}", metadata.len())
}

/// The texture stores (`*.ttpf`) materials take their textures from: `data/ttdb` and each pack's `data/ttdb`.
pub fn texture_stores(game_root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("ttpf")) {
                out.push(path);
            }
        }
    }
    let mut stores = Vec::new();
    walk(&game_root.join("data").join("ttdb"), &mut stores);
    for pack in std::fs::read_dir(game_root.join("pack"))
        .into_iter()
        .flatten()
        .flatten()
    {
        walk(&pack.path().join("data").join("ttdb"), &mut stores);
    }
    stores.sort();
    stores
}

/// The state of every texture store, as a short folder name: a model exported while a store was missing or still
/// downloading names its textures as missing, so exports go under this and are redone when a store changes.
pub(crate) fn stores_version(game_root: &Path) -> String {
    let state: String = texture_stores(game_root).iter().map(|store| version(store)).collect();
    let hash = state.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("t{hash:016x}")
}

/// Removes, once per run, the export folders of states the game folder is no longer in: every archive or texture
/// store that changed (a download, an update) left its own folder of models, vehicles, characters and weapons, a
/// gigabyte or more. A folder is kept when its first name part is the state of a present archive and any texture
/// store part is the stores' current state.
pub(crate) fn prune_stale_exports(game_root: &Path, work_dir: &Path) {
    static DONE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    DONE.get_or_init(|| {
        let workspace = sixng_core::export::Workspace::new(game_root, work_dir);
        let archives: std::collections::HashSet<String> = workspace
            .archives()
            .iter()
            .map(|archive| version(&archive.path))
            .collect();
        // No archive found (the game folder moved): nothing can be told stale.
        if archives.is_empty() {
            return;
        }
        let stores = stores_version(game_root);
        let is_stores = |part: &str| part.len() == 17 && part.starts_with('t');
        for kind in ["models", "vehicles", "characters", "weapons"] {
            let Ok(folders) = std::fs::read_dir(work_dir.join(kind)) else {
                continue;
            };
            for folder in folders.flatten() {
                let name = folder.file_name().to_string_lossy().into_owned();
                let mut parts = name.split('_');
                let current = parts.next().is_some_and(|first| archives.contains(first))
                    && name
                        .split('_')
                        .filter(|part| is_stores(part))
                        .all(|part| part == stores);
                if !current {
                    let _ = std::fs::remove_dir_all(folder.path());
                }
            }
        }
    });
}

/// Whether `output` is missing or older than any of `inputs` that exist.
pub(crate) fn stale(output: &Path, inputs: &[PathBuf]) -> bool {
    let modified = |path: &Path| std::fs::metadata(path).and_then(|m| m.modified()).ok();
    let Some(built) = modified(output) else { return true };
    inputs
        .iter()
        .filter_map(|input| modified(input))
        .any(|changed| changed > built)
}

/// Export options: PNG textures (textures embedded in models included), nothing else.
pub(crate) fn options(out: &Path, force: bool) -> Result<ExportOptions> {
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
    prune_stale_exports(game_root, work_dir);
    let workspace = Workspace::new(game_root, work_dir);
    let archive = workspace.resolve(archive_id)?;
    let index = crate::index_cache::load(&workspace.index_dir(), &archive.id)?;
    let entry = index
        .entries
        .iter()
        .find(|entry| entry.off == offset)
        .with_context(|| format!("no resource at {offset:#x} in {archive_id}"))?;
    anyhow::ensure!(is_model(entry), "the resource at {offset:#x} is not a model");

    let out = work_dir
        .join("models")
        .join(format!("{}_{}", version(&archive.path), stores_version(game_root)));
    // An earlier export is reused ("skipped" lists no files); export again only when its files cannot be found.
    for force in [false, true] {
        let items = export_many(&archive, &[entry], &options(&out, force)?, Arc::new(|_, _, _| {}))?;
        let item = items.first().context("the export returned nothing")?;
        if let Some(error) = &item.error {
            bail!("SixNG could not export this model: {error}");
        }
        if let Some(file) = item.files.iter().find(|file| file.ends_with("model.glb")) {
            // SixNG names files with forward slashes: one separator throughout.
            return Ok(out.join(file.split('/').collect::<PathBuf>()));
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
    prune_stale_exports(game_root, work_dir);
    let model = model.to_ascii_lowercase();
    let sources = format!(
        "{}_{}_{}",
        version(&game_root.join(VEHICLE_MODELS)),
        version(&game_root.join("packs.rpf")),
        stores_version(game_root)
    );
    // All configurations of a vehicle share one folder, so the textures decoded for one are reused by the next.
    let out = work_dir
        .join("vehicles")
        .join(sources)
        .join(&model)
        .join(format!("{model}_{config}.glb"));
    if out.is_file() {
        return Ok(out);
    }

    let workspace = Workspace::new(game_root, work_dir);
    let catalog = work_dir.join("catalog");
    let tables = catalog.join("vehicles").join("vehicles.json");
    // Built from packs.rpf (and data.rpf for names): rebuilt when either changed since.
    if stale(&tables, &[game_root.join("packs.rpf"), game_root.join("data.rpf")]) {
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
    let index = crate::index_cache::load(&workspace.index_dir(), VEHICLE_MODELS)?;
    let parent = out.parent().context("vehicle export path has no folder")?;
    // Without force, textures already decoded are kept; force only if that left no GLB.
    for force in [false, true] {
        vehexport::export_vehicle(
            &archive,
            &index,
            vehicle,
            config,
            &[],
            &[],
            true,
            &out,
            &options(parent, force)?,
        )?;
        if out.is_file() {
            break;
        }
    }
    anyhow::ensure!(out.is_file(), "SixNG exported no GLB for {model}");
    Ok(out)
}

/// One texture slot of a material, as SixNG resolved it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureSlot {
    /// The slot's name (`diffusetex`...), else its hash.
    pub slot: String,
    /// What the texture is guessed to be: colour, normal, data...
    pub role: Option<String>,
    /// `ok`, `not in any ttpf store` (its store is missing or incomplete), `embedded in the model`...
    pub status: String,
    /// The decoded PNG on disk, when there is one.
    pub file: Option<PathBuf>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub format: Option<String>,
}

/// One material of an exported model, with its textures.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialReport {
    pub index: usize,
    pub shader: String,
    pub class: Option<String>,
    pub textures: Vec<TextureSlot>,
}

/// The materials SixNG described beside the GLB `glb` (`materials.json`), each texture with its status and its PNG
/// resolved to a path. Empty when the export has no such file.
pub fn material_report(glb: &Path) -> Result<Vec<MaterialReport>> {
    let folder = glb.parent().context("the GLB has no folder")?;
    let path = folder.join("materials.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let json: Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    let text = |value: &Value| value.as_str().map(str::to_owned);
    // Files are relative to the export folder, an ancestor of the model's folder.
    let resolve = |file: &str| {
        folder
            .ancestors()
            .map(|base| base.join(file.split('/').collect::<PathBuf>()))
            .find(|candidate| candidate.is_file())
    };
    Ok(json["materials"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(position, material)| MaterialReport {
            index: material["index"].as_u64().map_or(position, |i| i as usize),
            shader: text(&material["shader"]).unwrap_or_default(),
            class: text(&material["class"]),
            textures: material["textures"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(slot, texture)| TextureSlot {
                    slot: slot.clone(),
                    role: text(&texture["role"]),
                    status: text(&texture["status"]).unwrap_or_else(|| "unknown".into()),
                    file: texture["file"].as_str().and_then(resolve),
                    width: texture["width"].as_u64(),
                    height: texture["height"].as_u64(),
                    format: text(&texture["format"]),
                })
                .collect(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_materials_with_their_texture_files() {
        let dir = std::env::temp_dir().join(format!("openvi-materials-{}", std::process::id()));
        let model = dir.join("models").join("common").join("car_10");
        let textures = dir.join("textures").join("ttpf");
        std::fs::create_dir_all(&model).unwrap();
        std::fs::create_dir_all(&textures).unwrap();
        std::fs::write(textures.join("aa.png"), b"png").unwrap();
        let glb = model.join("model.glb");
        std::fs::write(
            model.join("materials.json"),
            json!({ "materials": [{
                "index": 0, "shader": "vehicle_paint", "class": "car_paint",
                "textures": {
                    "diffusetex": { "file": "textures/ttpf/aa.png", "role": "colour (sRGB)", "status": "ok", "width": 64 },
                    "bumptex": { "status": "not in any ttpf store", "role": "normal" }
                }
            }]})
            .to_string(),
        )
        .unwrap();

        let report = material_report(&glb);
        let none = material_report(&dir.join("model.glb"));
        let file = textures.join("aa.png");
        std::fs::remove_dir_all(&dir).unwrap();

        let report = report.unwrap();
        assert_eq!(report.len(), 1);
        assert_eq!(report[0].class.as_deref(), Some("car_paint"));
        let slots: Vec<_> = report[0]
            .textures
            .iter()
            .map(|t| (t.slot.as_str(), t.status.as_str()))
            .collect();
        assert_eq!(slots, [("bumptex", "not in any ttpf store"), ("diffusetex", "ok")]);
        assert_eq!(report[0].textures[1].file.as_deref(), Some(file.as_path()));
        assert!(report[0].textures[0].file.is_none());
        assert!(none.unwrap().is_empty());
    }

    #[test]
    fn finds_texture_stores_and_versions_them() {
        let root = std::env::temp_dir().join(format!("openvi-stores-{}", std::process::id()));
        std::fs::create_dir_all(root.join("data").join("ttdb").join("vehicles")).unwrap();
        std::fs::create_dir_all(root.join("pack").join("story000").join("data").join("ttdb")).unwrap();
        std::fs::write(root.join("data").join("ttdb").join("vehicles").join("v.ttpf"), [0u8; 8]).unwrap();
        let before = stores_version(&root);
        std::fs::write(
            root.join("pack")
                .join("story000")
                .join("data")
                .join("ttdb")
                .join("s.ttpf"),
            [0u8; 8],
        )
        .unwrap();
        let stores = texture_stores(&root);
        let after = stores_version(&root);
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(stores.len(), 2);
        assert_ne!(before, after);
    }
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
    fn a_changed_archive_gets_its_own_export_folder() {
        let dir = std::env::temp_dir().join(format!("openvi-model-version-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("levels.rpf");
        std::fs::write(&archive, [0u8; 16]).unwrap();
        let before = version(&archive);
        let fresh_output = dir.join("vehicles.json");
        std::fs::write(&fresh_output, b"{}").unwrap();
        let up_to_date = !stale(&fresh_output, &[archive.clone(), dir.join("absent.rpf")]);
        std::fs::write(&archive, [0u8; 32]).unwrap();
        let after = version(&archive);
        let missing = version(&dir.join("absent.rpf"));
        let no_output = stale(&dir.join("none.json"), &[archive]);
        std::fs::remove_dir_all(&dir).unwrap();

        assert_ne!(before, after);
        assert!(before.starts_with("10-") && after.starts_with("20-"));
        assert_eq!(missing, "missing");
        assert!(up_to_date && no_output);
    }

    #[test]
    fn needs_the_vehicle_models() {
        let (root, _) = game("vehicle");
        let result = vehicle_glb(&root, &root.join("work"), "phoenix", 0, |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.is_err());
    }
}
