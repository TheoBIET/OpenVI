//! The map: every entity the map files of `levels.rpf` place in the world (buildings, props, trees…), with its
//! position and model, for a top-down view in the spirit of CodeWalker.
//!
//! Map files are self-describing meta resources (`0x7a`) that `sixng_core::meta7a::map_file` decodes into entities
//! (archetype hash, position in RAGE world space, Z-up, metres). Interior contents sit in other files, in interior
//! space, and are not read here. The index is compact (16 bytes an entity: x, y, z, model) and kept in
//! `<work>/index/map.<levels.rpf state>.bin` with the model names beside it, then in memory.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result, ensure};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sixng_core::classify::Kind;
use sixng_core::export::Workspace;
use sixng_core::resource::Resource;

use crate::model::VEHICLE_MODELS;
use crate::{ScanPhase, scan_archive};

/// The archive holding the map files.
pub const MAP_ARCHIVE: &str = VEHICLE_MODELS;

/// Every placed entity: `x, y, z` (RAGE world space, metres) and `model` (an index into `models`).
pub struct MapIndex {
    pub models: Vec<String>,
    pub entities: Vec<([f32; 3], u32)>,
    /// Map files read.
    pub files: usize,
    /// The interiors the map files place.
    pub interiors: Vec<Interior>,
}

/// An interior (an MLO: a building's inside) placed in the world.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interior {
    /// Its archetype's name, or its hash (8 hex digits) when unknown.
    pub name: String,
    /// RAGE world space, metres.
    pub position: [f32; 3],
    /// From its definition, when found: rooms, entities and entity sets (optional states: a shop open or closed…).
    pub rooms: usize,
    pub entities: usize,
    pub sets: usize,
    /// Whether its definition (in another map file, in interior space) was found.
    pub defined: bool,
}

/// What the index holds, for the view's header.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSummary {
    pub entities: usize,
    pub models: usize,
    pub files: usize,
    /// `[min x, min y, max x, max y]` of the entities, metres.
    pub bounds: [f32; 4],
}

impl MapIndex {
    pub fn summary(&self) -> MapSummary {
        let mut bounds = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for (position, _) in &self.entities {
            bounds[0] = bounds[0].min(position[0]);
            bounds[1] = bounds[1].min(position[1]);
            bounds[2] = bounds[2].max(position[0]);
            bounds[3] = bounds[3].max(position[1]);
        }
        if self.entities.is_empty() {
            bounds = [0.0; 4];
        }
        MapSummary {
            entities: self.entities.len(),
            models: self.models.len(),
            files: self.files,
            bounds,
        }
    }

    /// The entities as little-endian bytes, 16 each: `x, y, z` as f32, then the model index as u32.
    pub fn points(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.entities.len() * 16);
        for (position, model) in &self.entities {
            for value in position {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            bytes.extend_from_slice(&model.to_le_bytes());
        }
        bytes
    }

    fn from_points(models: Vec<String>, files: usize, interiors: Vec<Interior>, bytes: &[u8]) -> Self {
        let entities = bytes
            .as_chunks::<16>()
            .0
            .iter()
            .map(|chunk| {
                let float = |at: usize| f32::from_le_bytes([chunk[at], chunk[at + 1], chunk[at + 2], chunk[at + 3]]);
                let model = u32::from_le_bytes([chunk[12], chunk[13], chunk[14], chunk[15]]);
                ([float(0), float(4), float(8)], model)
            })
            .collect();
        Self {
            models,
            entities,
            files,
            interiors,
        }
    }
}

/// One entity as a map file places it: position, archetype hash, model name when known.
type Placed = ([f32; 3], u32, Option<String>);

/// What one meta resource holds for the map: placed entities, interior instances (position, archetype) and interior
/// definitions (name hash, rooms, entities, sets).
type Read = (Vec<Placed>, Vec<([f32; 3], u32)>, Vec<(u32, usize, usize, usize)>);

/// Reads every map file of `levels.rpf` (in parallel; `progress` counts files).
fn build(game_root: &Path, work_dir: &Path, progress: &(impl Fn(u64, u64) + Sync)) -> Result<MapIndex> {
    let workspace = Workspace::new(game_root, work_dir);
    let archive = workspace.resolve(MAP_ARCHIVE)?;
    let index = crate::index_cache::load(&workspace.index_dir(), MAP_ARCHIVE)?;
    let names = sixng_core::export::model_names(&workspace);
    let metas: Vec<&sixng_core::scan::Entry> = index
        .entries
        .iter()
        .filter(|entry| entry.kind == Kind::Resource && entry.sub == "7a")
        .collect();
    let total = metas.len() as u64;
    let done = AtomicU64::new(0);
    let read: Vec<Read> = metas
        .par_iter()
        .filter_map(|entry| {
            let count = done.fetch_add(1, Ordering::Relaxed) + 1;
            if count.is_multiple_of(256) || count == total {
                progress(count, total);
            }
            let resource = Resource::load_sys(&archive.path, entry).ok()?;
            let meta = sixng_core::meta7a::Meta::parse(&resource)?;
            let placed: Vec<Placed> = sixng_core::meta7a::map_file(&resource, &names)
                .map(|file| {
                    file.entities
                        .into_iter()
                        .map(|entity| (entity.position, entity.archetype, entity.name))
                        .collect()
                })
                .unwrap_or_default();
            let instances: Vec<([f32; 3], u32)> = sixng_core::meta7a::mlo_instances(&meta)
                .into_iter()
                .map(|instance| (instance.position, instance.archetype))
                .collect();
            let definitions: Vec<(u32, usize, usize, usize)> = sixng_core::meta7a::mlos(&meta)
                .into_iter()
                .map(|mlo| (mlo.name, mlo.rooms.len(), mlo.entities.len(), mlo.sets.len()))
                .collect();
            let any = !placed.is_empty() || !instances.is_empty() || !definitions.is_empty();
            any.then_some((placed, instances, definitions))
        })
        .collect();
    let definitions: HashMap<u32, (usize, usize, usize)> = read
        .iter()
        .flat_map(|(_, _, definitions)| definitions)
        .map(|(name, rooms, entities, sets)| (*name, (*rooms, *entities, *sets)))
        .collect();
    let interiors = read
        .iter()
        .flat_map(|(_, instances, _)| instances)
        .map(|(position, archetype)| {
            let found = definitions.get(archetype);
            let (rooms, entities, sets) = found.copied().unwrap_or_default();
            Interior {
                name: names
                    .get(archetype)
                    .map_or_else(|| format!("{archetype:08x}"), |(name, _)| name.clone()),
                position: *position,
                rooms,
                entities,
                sets,
                defined: found.is_some(),
            }
        })
        .collect();
    let files: Vec<&Vec<Placed>> = read
        .iter()
        .map(|(placed, ..)| placed)
        .filter(|placed| !placed.is_empty())
        .collect();
    let mut models: Vec<String> = Vec::new();
    let mut by_hash: HashMap<u32, u32> = HashMap::new();
    let mut entities = Vec::new();
    for (position, archetype, name) in files.iter().copied().flatten() {
        let model = *by_hash.entry(*archetype).or_insert_with(|| {
            models.push(name.clone().unwrap_or_else(|| format!("{archetype:08x}")));
            (models.len() - 1) as u32
        });
        entities.push((*position, model));
    }
    Ok(MapIndex {
        models,
        entities,
        files: files.len(),
        interiors,
    })
}

type Loaded = (String, Arc<MapIndex>);

/// The map index for the current state of `levels.rpf` (scanned first if needed): from memory, from its cache, or
/// built (a few minutes; `progress` counts map files).
pub fn map_index(
    game_root: &Path,
    work_dir: &Path,
    scanning: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
    progress: impl Fn(u64, u64) + Sync,
) -> Result<Arc<MapIndex>> {
    static MEMORY: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    let path = game_root.join(MAP_ARCHIVE);
    ensure!(path.is_file(), "{} has no {MAP_ARCHIVE}", game_root.display());
    let workspace = Workspace::new(game_root, work_dir);
    scan_archive(&path, MAP_ARCHIVE, &workspace.index_dir(), scanning)?;
    // The scan in use (it may be an earlier one while the archive is still being written).
    let scan = crate::index_cache::load(&workspace.index_dir(), MAP_ARCHIVE)?;
    let state = format!("{}_{}", scan.size, scan.mtime);
    let memory = MEMORY.get_or_init(Default::default);
    if let Some((known, index)) = memory.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref()
        && *known == state
    {
        return Ok(Arc::clone(index));
    }
    // `map2`: the index with interiors.
    let points = workspace.index_dir().join(format!("map2.{state}.bin"));
    let names = workspace.index_dir().join(format!("map2.{state}.json"));
    let cached = std::fs::read(&points).ok().zip(
        std::fs::read(&names)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<(Vec<String>, usize, Vec<Interior>)>(&bytes).ok()),
    );
    let index = match cached {
        Some((bytes, (models, files, interiors))) => MapIndex::from_points(models, files, interiors, &bytes),
        None => {
            let index = build(game_root, work_dir, &progress)?;
            // Only the current state's index is kept.
            for entry in std::fs::read_dir(workspace.index_dir())?.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("map") && (name.ends_with(".bin") || name.ends_with(".json")) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
            std::fs::write(&points, index.points()).context("writing the map index")?;
            std::fs::write(
                &names,
                serde_json::to_vec(&(&index.models, index.files, &index.interiors))?,
            )?;
            index
        }
    };
    let index = Arc::new(index);
    *memory.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((state, Arc::clone(&index)));
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_points_and_reads_them_back() {
        let index = MapIndex {
            models: vec!["prop_bench_01".into()],
            entities: vec![([1.5, -2.0, 30.25], 0), ([-100.0, 250.0, 0.0], 0)],
            files: 1,
            interiors: Vec::new(),
        };
        let bytes = index.points();
        assert_eq!(bytes.len(), 32);
        let back = MapIndex::from_points(index.models.clone(), 1, Vec::new(), &bytes);
        assert_eq!(back.entities, index.entities);
        assert_eq!(index.summary().bounds, [-100.0, -2.0, 1.5, 250.0]);
    }

    #[test]
    fn needs_the_map_archive() {
        let root = std::env::temp_dir().join(format!("openvi-map-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let index = map_index(&root, &root.join("work"), |_, _, _| {}, |_, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(index.is_err());
    }
}
