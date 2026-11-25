//! One area of the map in 3D: the entities placed within a radius of a point, each model exported once and placed
//! with its own transform, written as an assembly manifest the 3D view loads (as for weapons).
//!
//! Only what is drawn up close is kept: high-detail entities (`lodLevel` HD or orphan HD), not their low-detail
//! stand-ins (LOD, SLOD…) and not proxies (`Entity::render` false). Models are exported in one batch into the models
//! folder; which GLB each resource became is remembered in `<models folder>/glbs.json`, since SixNG reports an export
//! it skips (already done) without its files.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use serde::Serialize;
use sixng_core::export::{Workspace, export_many};
use sixng_core::resource::Resource;

use crate::map::{MAP_ARCHIVE, map_index};
use crate::model::{options, stores_version, version};

/// An area put together in 3D.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    /// The manifest the 3D view loads.
    pub manifest: PathBuf,
    /// Entities placed, and the distinct models they use.
    pub entities: usize,
    pub models: usize,
    /// Entities left out: no model found, or a model that did not export.
    pub missing: usize,
}

#[derive(Serialize)]
struct Manifest {
    kind: &'static str,
    name: String,
    models: Vec<Placed>,
}

#[derive(Serialize)]
struct Placed {
    name: String,
    glb: PathBuf,
    matrix: [f32; 16],
}

/// Column-major matrix of a translation, a rotation (quaternion x, y, z, w) and a scale.
fn compose(translation: [f32; 3], rotation: [f32; 4], scale: [f32; 3]) -> [f32; 16] {
    let [x, y, z, w] = rotation;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let [sx, sy, sz] = scale;
    [
        (1.0 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0.0,
        (xy - wz) * sy,
        (1.0 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0.0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1.0 - (xx + yy)) * sz,
        0.0,
        translation[0],
        translation[1],
        translation[2],
        1.0,
    ]
}

type Names = std::collections::HashMap<u32, (String, String)>;

/// The names read for one state of the archive.
type NamesFor = (String, Arc<Names>);

/// The model names of the indexed archives (archetype hash to name and entry), read once per state of `levels.rpf`:
/// reading them takes seconds.
fn model_names(workspace: &Workspace, state: &str) -> Arc<Names> {
    static MEMORY: std::sync::OnceLock<std::sync::Mutex<Option<NamesFor>>> = std::sync::OnceLock::new();
    let memory = MEMORY.get_or_init(Default::default);
    let mut held = memory.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some((known, names)) = held.as_ref()
        && known == state
    {
        return Arc::clone(names);
    }
    let names = Arc::new(sixng_core::export::model_names(workspace));
    *held = Some((state.to_string(), Arc::clone(&names)));
    names
}

/// Whether an entity is drawn up close: high detail, and not a proxy.
fn close_up(entity: &sixng_core::meta7a::Entity) -> bool {
    let level = entity.lod["level"].as_str().unwrap_or("unknown");
    entity.render != Some(false) && matches!(level, "HD" | "ORPHAN_HD" | "unknown")
}

/// The GLB of each resource of `archive` at `offsets`, exporting the ones not exported yet in one batch
/// (`progress` counts them).
fn model_glbs(
    workspace: &Workspace,
    game_root: &Path,
    work_dir: &Path,
    offsets: &[u64],
    progress: impl Fn(u64, u64) + Send + Sync + 'static,
) -> Result<HashMap<u64, PathBuf>> {
    crate::model::prune_stale_exports(game_root, work_dir);
    let archive = workspace.resolve(MAP_ARCHIVE)?;
    let index = crate::index_cache::load(&workspace.index_dir(), MAP_ARCHIVE)?;
    let out = work_dir
        .join("models")
        .join(format!("{}_{}", version(&archive.path), stores_version(game_root)));
    let known_path = out.join("glbs.json");
    let mut known: BTreeMap<u64, PathBuf> = std::fs::read(&known_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    known.retain(|_, glb| glb.is_file());
    let wanted: Vec<&sixng_core::scan::Entry> = index
        .entries
        .iter()
        .filter(|entry| offsets.contains(&entry.off) && !known.contains_key(&entry.off))
        .collect();
    let progress = Arc::new(progress);
    let mut left = wanted;
    // Without force first (textures decoded for other models are kept); force only what that left without a GLB.
    for force in [false, true] {
        if left.is_empty() {
            break;
        }
        let total = left.len() as u64;
        let report = Arc::clone(&progress);
        let items = export_many(
            &archive,
            &left,
            &options(&out, force)?,
            Arc::new(move |_, done, _| report(done, total)),
        )?;
        let by_id: HashMap<&str, &sixng_core::export::ExportedItem> =
            items.iter().map(|item| (item.id.as_str(), item)).collect();
        let mut again = Vec::new();
        for entry in left {
            let glb = by_id
                .get(entry.id.as_str())
                .and_then(|item| item.files.iter().find(|file| file.ends_with("model.glb")));
            match glb {
                Some(file) => {
                    known.insert(entry.off, out.join(file));
                }
                None => again.push(entry),
            }
        }
        left = again;
    }
    std::fs::create_dir_all(&out)?;
    std::fs::write(&known_path, serde_json::to_vec(&known)?)?;
    Ok(offsets
        .iter()
        .filter_map(|offset| known.get(offset).map(|glb| (*offset, glb.clone())))
        .collect())
}

/// The area within `radius` metres of `(x, y)` (RAGE world space), at most `max_models` distinct models (the nearest
/// first), as an assembly manifest centred on the point. Needs the map index (built first if needed).
pub fn map_area(
    game_root: &Path,
    work_dir: &Path,
    x: f32,
    y: f32,
    radius: f32,
    max_models: usize,
    progress: impl Fn(u64, u64) + Send + Sync + 'static,
) -> Result<Area> {
    let index = map_index(game_root, work_dir, |_, _, _| {}, |_, _| {})?;
    let workspace = Workspace::new(game_root, work_dir);
    let archive = workspace.resolve(MAP_ARCHIVE)?;
    let scan = crate::index_cache::load(&workspace.index_dir(), MAP_ARCHIVE)?;
    let names = model_names(&workspace, &format!("{}_{}", scan.size, scan.mtime));
    let near = |bounds: &[f32; 4]| {
        bounds[0] - radius <= x && x <= bounds[2] + radius && bounds[1] - radius <= y && y <= bounds[3] + radius
    };
    let prefix = format!("{MAP_ARCHIVE}@");
    // Entities in the circle: (distance, model offset, model name, transform).
    let mut found: Vec<(f32, u64, String, sixng_core::meta7a::GltfTransform)> = Vec::new();
    let mut missing = 0;
    for region in index.regions.iter().filter(|region| near(&region.bounds)) {
        let Some(entry) = scan.entries.iter().find(|entry| entry.off == region.offset) else {
            continue;
        };
        let Ok(resource) = Resource::load_sys(&archive.path, entry) else {
            continue;
        };
        let Some(file) = sixng_core::meta7a::map_file(&resource, &names) else {
            continue;
        };
        for entity in file.entities {
            let distance = (entity.position[0] - x).hypot(entity.position[1] - y);
            // Entities left at the origin are not placed in the world (unplaced templates).
            let unplaced = entity.position[0].abs() < 1.0 && entity.position[1].abs() < 1.0;
            if distance > radius || unplaced || !close_up(&entity) {
                continue;
            }
            let offset = entity
                .model_id
                .as_deref()
                .and_then(|id| id.strip_prefix(&prefix))
                .and_then(|hex| u64::from_str_radix(hex.trim_start_matches("0x"), 16).ok());
            match offset {
                Some(offset) => found.push((
                    distance,
                    offset,
                    entity.name.clone().unwrap_or_default(),
                    entity.gltf.clone(),
                )),
                None => missing += 1,
            }
        }
    }
    // The nearest models first, up to `max_models`.
    found.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut kept: Vec<u64> = Vec::new();
    let mut seen = HashSet::new();
    for (_, offset, ..) in &found {
        if seen.insert(*offset) && kept.len() < max_models {
            kept.push(*offset);
        }
    }
    let kept_set: HashSet<u64> = kept.iter().copied().collect();
    let glbs = model_glbs(&workspace, game_root, work_dir, &kept, progress)?;

    // glTF is Y-up: the point (x, y) is at (x, -y) on the ground plane; heights stay as they are.
    let ground = found
        .iter()
        .map(|(.., transform)| transform.translation[1])
        .fold(f32::MAX, f32::min);
    let ground = if ground.is_finite() { ground } else { 0.0 };
    let mut models = Vec::new();
    for (_, offset, name, transform) in &found {
        let Some(glb) = glbs.get(offset).filter(|_| kept_set.contains(offset)) else {
            missing += 1;
            continue;
        };
        let translation = [
            transform.translation[0] - x,
            transform.translation[1] - ground,
            transform.translation[2] + y,
        ];
        models.push(Placed {
            name: name.clone(),
            glb: glb.clone(),
            matrix: compose(translation, transform.rotation, transform.scale),
        });
    }
    let entities = models.len();
    let manifest = work_dir.join("areas").join(format!(
        "area_{}_{}_{}.weapon.json",
        x.round(),
        y.round(),
        radius.round()
    ));
    std::fs::create_dir_all(manifest.parent().context("area path has no folder")?)?;
    std::fs::write(
        &manifest,
        serde_json::to_vec(&Manifest {
            kind: "openvi.assembly",
            name: format!("{x:.0}, {y:.0}"),
            models,
        })?,
    )?;
    Ok(Area {
        manifest,
        entities,
        models: kept.len(),
        missing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composes_translation_rotation_and_scale() {
        let identity = compose([1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0], [2.0, 2.0, 2.0]);
        assert_eq!(identity[0], 2.0);
        assert_eq!(&identity[12..15], &[1.0, 2.0, 3.0]);
        // A quarter turn about Y sends +X to -Z.
        let half = std::f32::consts::FRAC_1_SQRT_2;
        let turned = compose([0.0; 3], [0.0, half, 0.0, half], [1.0; 3]);
        assert!((turned[2] + 1.0).abs() < 1e-6);
    }
}
