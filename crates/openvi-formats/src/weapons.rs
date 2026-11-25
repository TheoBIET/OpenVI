//! Weapons: every weapon model of the game, the parts each one is built from (receiver, barrel, stock, magazine…),
//! and one assembled from the parts chosen.
//!
//! A weapon model (`w_ar_adb_01_hi`) is a skeleton with a placeholder shell; what the game shows is separate part
//! models (`w_ar_adb_01_barrel_02_hi`) mounted on its attach-point bones (`sixng_core::weapon`). Each part is exported
//! on its own like any model; [`weapon_assembly`] writes a small manifest naming those GLBs with the matrix that puts
//! each on its mount, which the 3D view loads as one model.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sixng_core::export::Workspace;
use sixng_core::scan::{ArchiveIndex, Entry};
use sixng_core::weapon::{self, Mat};

use crate::model::{model_glb, stores_version, version};
use crate::{ScanPhase, scan_archive};

/// The archives that hold weapon models and their parts.
pub const WEAPON_ARCHIVES: [&str; 2] = ["data.rpf", "packs.rpf"];

/// One weapon model.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weapon {
    /// The weapon's name without its level suffix (`w_ar_adb_01`): the id.
    pub name: String,
    /// Its class from the name (`ar`: assault rifle) and the word after it (`adb`, often the make).
    pub class: String,
    pub class_name: String,
    pub make: String,
    /// The archive holding it and the model it is built on (`w_ar_adb_01_hi`).
    pub archive: String,
    pub model: String,
    /// Part models, and the slots they fill (barrel, stock…).
    pub parts: usize,
    pub slots: usize,
}

/// One part a weapon can be built with; parts of one `group` (slot) replace each other.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponPart {
    pub offset: u64,
    pub name: String,
    pub group: String,
    pub label: String,
    /// In the default build (the lowest-numbered variant of each slot: which one the game uses is not decoded).
    pub default: bool,
}

/// A weapon assembled: the manifest the 3D view loads, and the parts that found no mount.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponAssembly {
    pub manifest: PathBuf,
    pub unmounted: Vec<String>,
}

/// The manifest: GLB files and the column-major glTF (Y-up) matrix of each.
#[derive(Debug, Serialize)]
struct Manifest {
    kind: &'static str,
    name: String,
    models: Vec<Placed>,
}

#[derive(Debug, Serialize)]
struct Placed {
    name: String,
    glb: PathBuf,
    matrix: Mat,
}

/// Human names of the class codes in weapon names.
fn class_name(code: &str) -> &'static str {
    match code {
        "ar" => "Assault rifle",
        "pi" => "Pistol",
        "sg" => "Shotgun",
        "sb" | "smg" => "Submachine gun",
        "mg" => "Machine gun",
        "sr" => "Sniper rifle",
        "me" => "Melee",
        "lr" => "Launcher",
        "ex" => "Explosive",
        "am" => "Ammunition",
        "at" => "Attachment",
        "bo" => "Bow",
        _ => "Other",
    }
}

/// The weapon's stem (`w_ar_adb_01`) and level suffix of a model name.
fn stem(name: &str) -> (&str, &str) {
    for suffix in ["_hi", "_mid"] {
        if let Some(base) = name.strip_suffix(suffix) {
            return (base, suffix);
        }
    }
    (name, "")
}

/// Scans `archive` if needed and loads its index.
fn archive_index(
    game_root: &Path,
    workspace: &Workspace,
    archive: &str,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Arc<ArchiveIndex>> {
    scan_archive(&game_root.join(archive), archive, &workspace.index_dir(), progress)?;
    crate::index_cache::load(&workspace.index_dir(), archive)
}

/// The model each weapon is built on in `index`: by stem, its `_hi` copy, else the bare name, else `_mid`.
fn weapon_models(index: &ArchiveIndex) -> BTreeMap<String, &Entry> {
    let rank = |suffix: &str| match suffix {
        "_hi" => 0,
        "" => 1,
        _ => 2,
    };
    let mut found: BTreeMap<String, (u8, &Entry)> = BTreeMap::new();
    for entry in &index.entries {
        let Some(name) = entry.name.as_deref() else { continue };
        if !matches!(entry.rtype.as_deref(), Some("dr" | "ft")) || !weapon::is_weapon(name) {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        let (base, suffix) = stem(&lower);
        let level = rank(suffix);
        if found.get(base).is_none_or(|(best, _)| level < *best) {
            found.insert(base.to_string(), (level, entry));
        }
    }
    found.into_iter().map(|(base, (_, entry))| (base, entry)).collect()
}

/// Every weapon of the game, by name. Scans the weapon archives first if needed (`progress` per archive).
pub fn weapon_list(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(&str, ScanPhase, u64, u64) + Send + Sync + Clone + 'static,
) -> Result<Vec<Weapon>> {
    let workspace = Workspace::new(game_root, work_dir);
    let present: Vec<&str> = WEAPON_ARCHIVES
        .into_iter()
        .filter(|archive| game_root.join(archive).is_file())
        .collect();
    ensure!(
        !present.is_empty(),
        "{} has none of {}",
        game_root.display(),
        WEAPON_ARCHIVES.join(", ")
    );
    let mut weapons: BTreeMap<String, Weapon> = BTreeMap::new();
    for archive in present {
        let report = progress.clone();
        let index = archive_index(game_root, &workspace, archive, move |phase, done, total| {
            report(archive, phase, done, total);
        })?;
        for (base, entry) in weapon_models(&index) {
            if weapons.contains_key(&base) {
                continue;
            }
            let model = entry.name.clone().unwrap_or_default();
            let options = weapon::weapon_options(&index.entries, &model);
            let mut slots: Vec<&str> = options.iter().map(|option| option.group.as_str()).collect();
            slots.dedup();
            let words: Vec<&str> = base.split('_').collect();
            let class = words.get(1).copied().unwrap_or_default().to_string();
            weapons.insert(
                base.clone(),
                Weapon {
                    class_name: class_name(&class).into(),
                    class,
                    make: words.get(2).copied().unwrap_or_default().to_string(),
                    archive: archive.into(),
                    model,
                    parts: options.len(),
                    slots: slots.len(),
                    name: base,
                },
            );
        }
    }
    Ok(weapons.into_values().collect())
}

/// The archive, index and model entry of weapon `name` (its stem).
fn find_weapon(
    game_root: &Path,
    workspace: &Workspace,
    name: &str,
) -> Result<(&'static str, Arc<ArchiveIndex>, Entry)> {
    let name = name.to_ascii_lowercase();
    for archive in WEAPON_ARCHIVES {
        if !game_root.join(archive).is_file() {
            continue;
        }
        let index = archive_index(game_root, workspace, archive, |_, _, _| {})?;
        if let Some(entry) = weapon_models(&index).get(&name).map(|entry| (*entry).clone()) {
            return Ok((archive, index, entry));
        }
    }
    anyhow::bail!("no weapon {name} in {}", WEAPON_ARCHIVES.join(" or "))
}

/// The parts weapon `name` can be built with, by slot.
pub fn weapon_parts(game_root: &Path, work_dir: &Path, name: &str) -> Result<Vec<WeaponPart>> {
    let workspace = Workspace::new(game_root, work_dir);
    let (_, index, entry) = find_weapon(game_root, &workspace, name)?;
    let model = entry.name.unwrap_or_default();
    Ok(weapon::weapon_options(&index.entries, &model)
        .into_iter()
        .map(|option| WeaponPart {
            offset: option.off,
            name: option.name,
            group: option.group.replace('_', " "),
            label: option.label,
            default: option.default,
        })
        .collect())
}

/// The bones of an exported model, from the `model.json` SixNG writes beside its GLB: (name, bone-to-model matrix).
fn bones(glb: &Path) -> Vec<(String, Mat)> {
    let Some(text) = glb
        .parent()
        .and_then(|folder| std::fs::read_to_string(folder.join("model.json")).ok())
    else {
        return Vec::new();
    };
    let Ok(info) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    info["drawable"]["skeleton"]
        .as_array()
        .map(|bones| {
            bones
                .iter()
                .filter_map(|bone| {
                    let name = bone["name"].as_str()?.to_string();
                    let matrix: Mat = serde_json::from_value(bone["bind_matrix"].clone()).ok()?;
                    Some((name, matrix))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// RAGE model space (Z-up) to glTF (Y-up): `(x, y, z)` → `(x, z, -y)`, column-major.
const TO_GLTF: Mat = [
    1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// A matrix of RAGE model space expressed in glTF space.
fn to_gltf(matrix: &Mat) -> Mat {
    weapon::mul(&weapon::mul(&TO_GLTF, matrix), &weapon::inverse_rigid(&TO_GLTF))
}

/// Weapon `name` built with `parts` (offsets from [`weapon_parts`]), or its default build when `None`: each part
/// exported (or reused) and placed on its mount. Writes the manifest into `<work>/weapons`.
pub fn weapon_assembly(game_root: &Path, work_dir: &Path, name: &str, parts: Option<&[u64]>) -> Result<WeaponAssembly> {
    let workspace = Workspace::new(game_root, work_dir);
    let (archive, index, entry) = find_weapon(game_root, &workspace, name)?;
    let model = entry.name.clone().unwrap_or_default();
    let options = weapon::weapon_options(&index.entries, &model);
    let mut chosen: Vec<u64> = match parts {
        Some(parts) => parts.to_vec(),
        None => options
            .iter()
            .filter(|option| option.default)
            .map(|option| option.off)
            .collect(),
    };
    chosen.sort_unstable();
    chosen.dedup();

    let base = model_glb(game_root, work_dir, archive, entry.off)?;
    let mut exported = Vec::new();
    for offset in &chosen {
        let option = options
            .iter()
            .find(|option| option.off == *offset)
            .with_context(|| format!("no part of {model} at {offset:#x}"))?;
        let glb =
            model_glb(game_root, work_dir, archive, *offset).with_context(|| format!("exporting {}", option.name))?;
        let slot = weapon::part_slot(&model, &option.name).unwrap_or_default();
        exported.push((option.name.clone(), slot, glb));
    }
    let placed = weapon::place(
        &bones(&base),
        &exported
            .iter()
            .map(|(_, slot, glb)| (slot.clone(), bones(glb)))
            .collect::<Vec<_>>(),
    );

    let mut models = Vec::new();
    let mut unmounted = Vec::new();
    for ((part, _, glb), matrix) in exported.into_iter().zip(placed) {
        match matrix {
            Some(matrix) => models.push(Placed {
                name: part,
                glb,
                matrix: to_gltf(&matrix),
            }),
            None => unmounted.push(part),
        }
    }
    // The placeholder shell only when no part could be mounted.
    if models.is_empty() {
        models.push(Placed {
            name: model.clone(),
            glb: base,
            matrix: weapon::IDENTITY,
        });
    }

    let fnv = |hash: u64, value: u64| (hash ^ value).wrapping_mul(0x0100_0000_01b3);
    let look = chosen
        .iter()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, offset| fnv(hash, *offset));
    let manifest = work_dir
        .join("weapons")
        .join(format!(
            "{}_{}",
            version(&game_root.join(archive)),
            stores_version(game_root)
        ))
        .join(format!(
            "{}_{look:016x}.weapon.json",
            stem(&model.to_ascii_lowercase()).0
        ));
    std::fs::create_dir_all(manifest.parent().context("manifest path has no folder")?)?;
    let body = Manifest {
        kind: "openvi.assembly",
        name: model,
        models,
    };
    std::fs::write(&manifest, serde_json::to_vec_pretty(&body)?)?;
    Ok(WeaponAssembly { manifest, unmounted })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_rage_matrices_to_gltf() {
        let mut up = weapon::IDENTITY;
        up[14] = 2.0; // two metres up (RAGE z)
        let converted = to_gltf(&up);
        assert_eq!(&converted[12..15], &[0.0, 2.0, 0.0]); // glTF y
    }

    #[test]
    fn names_the_weapon_classes() {
        assert_eq!(class_name("ar"), "Assault rifle");
        assert_eq!(class_name("zz"), "Other");
        assert_eq!(stem("w_ar_adb_01_hi"), ("w_ar_adb_01", "_hi"));
    }

    #[test]
    fn needs_a_weapon_archive() {
        let root = std::env::temp_dir().join(format!("openvi-weapons-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let list = weapon_list(&root, &root.join("work"), |_, _, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(list.unwrap_err().to_string().contains("data.rpf"));
    }
}
