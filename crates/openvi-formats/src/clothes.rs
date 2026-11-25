//! Clothes: the generic garments of `packs.rpf` (worn by any ped of their fit, not named after one character), and
//! one tried on a mannequin of its fit.
//!
//! A ped drawable is named `<item>_<fit>_<NNN>_…` (`tshirtcrewneck_mr1_004_…`): the item word gives the slot (top,
//! bottom, feet…), the fit tag the sex and body type (`m`/`f`, then a body letter and a number). A mannequin is the
//! fit's whole skin meshes (`hand_<fit>_000_full` for the upper body, `feet_<fit>_000_full` for the lower one) and its
//! first generic head, assembled with the garment like a character.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sixng_core::export::Workspace;
use sixng_core::scan::ArchiveIndex;
use sixng_core::{outfit, pedlook};

use crate::characters::{CHARACTER_PARTS, character_glb};
use crate::{ScanPhase, scan_archive};

/// Slots a garment fills (`pedlook::slot_of`); the rest are bodies, heads, hair and other parts of a person.
const GARMENT_SLOTS: [&str; 5] = ["full", "outer", "top", "bottom", "feet"];

/// One garment.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Garment {
    /// Its drawable name (`tshirtcrewneck_mr1_004_…`): the id.
    pub name: String,
    pub offset: u64,
    /// The item word (`tshirtcrewneck`) and the same in words (`tshirt crewneck`).
    pub item: String,
    pub label: String,
    /// `full`, `outer`, `top`, `bottom` or `feet`.
    pub slot: String,
    /// Fit tag (`mr1`) and the sex it is cut for.
    pub fit: String,
    pub sex: String,
    /// Its number among the item's (`004`).
    pub variant: String,
}

/// Garment words the game runs together (`jackettrack`), split after the known stem (`jacket track`).
fn label_of(word: &str) -> String {
    const STEMS: [&str; 25] = [
        "tshirt",
        "tanktop",
        "sweatshirt",
        "shirt",
        "hoodie",
        "jacket",
        "coat",
        "blazer",
        "pants",
        "shorts",
        "skirt",
        "dress",
        "shoes",
        "boots",
        "fullbody",
        "swimsuit",
        "undies",
        "bra",
        "basetops",
        "basebottoms",
        "vest",
        "gilet",
        "bodysuit",
        "blouse",
        "leggings",
    ];
    match STEMS
        .iter()
        .filter(|stem| word.starts_with(**stem) && word.len() > stem.len())
        .max_by_key(|stem| stem.len())
    {
        Some(stem) => format!("{stem} {}", &word[stem.len()..]),
        None => word.to_string(),
    }
}

/// The fit tag and the number after it in a ped drawable name.
fn fit_of(name: &str) -> Option<(&str, &str)> {
    let tokens: Vec<&str> = name.split('_').collect();
    let at = tokens.iter().position(|token| outfit::is_fit(token))?;
    Some((tokens[at], tokens.get(at + 1).copied().unwrap_or_default()))
}

fn parts_index(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<std::sync::Arc<ArchiveIndex>> {
    let path = game_root.join(CHARACTER_PARTS);
    ensure!(path.is_file(), "{} has no {CHARACTER_PARTS}", game_root.display());
    let workspace = Workspace::new(game_root, work_dir);
    scan_archive(&path, CHARACTER_PARTS, &workspace.index_dir(), progress)?;
    crate::index_cache::load(&workspace.index_dir(), CHARACTER_PARTS)
}

/// The LOD0 copy of every named drawable of `index`, by lower-case name.
fn drawables(index: &ArchiveIndex) -> BTreeMap<String, &sixng_core::scan::Entry> {
    outfit::dedupe(
        index
            .entries
            .iter()
            .filter(|entry| entry.rtype.as_deref() == Some("dr"))
            .filter_map(|entry| Some((entry.name.as_ref()?.to_ascii_lowercase(), entry))),
    )
}

/// Every generic garment of the game, by slot, item and fit. Scans `packs.rpf` first if needed.
pub fn garment_list(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Vec<Garment>> {
    let index = parts_index(game_root, work_dir, progress)?;
    let mut garments: Vec<Garment> = drawables(&index)
        .into_iter()
        .filter(|(name, _)| outfit::outfit_prefix(name).is_none() && !outfit::is_animal(name))
        .filter(|(name, _)| !name.contains("_cull") && !name.ends_with("_fp") && !name.contains("_fp_"))
        .filter_map(|(name, entry)| {
            let (fit, variant) = fit_of(&name)?;
            let slot = pedlook::slot_of(&name);
            if !GARMENT_SLOTS.contains(&slot.as_str()) {
                return None;
            }
            let item = pedlook::item_word(&name).to_string();
            Some(Garment {
                label: label_of(&item),
                sex: if fit.starts_with('f') { "female" } else { "male" }.into(),
                fit: fit.into(),
                variant: variant.into(),
                offset: entry.off,
                slot,
                item,
                name,
            })
        })
        .collect();
    garments.sort_by(|a, b| (&a.slot, &a.label, &a.fit, &a.name).cmp(&(&b.slot, &b.label, &b.fit, &b.name)));
    Ok(garments)
}

/// The mannequin of fit `fit`: its upper and lower skin meshes and its first generic head (offsets).
fn mannequin(index: &ArchiveIndex, fit: &str) -> Vec<u64> {
    let all = drawables(index);
    let mut parts = Vec::new();
    for word in ["hand", "feet"] {
        let skin = ["full", "nude_full", "nude_cull"]
            .iter()
            .find_map(|suffix| all.get(&format!("{word}_{fit}_000_{suffix}")));
        if let Some(entry) = skin {
            parts.push(entry.off);
        }
    }
    let head = all.iter().find(|(name, _)| {
        outfit::outfit_prefix(name).is_none()
            && pedlook::slot_of(name) == "head"
            && fit_of(name).is_some_and(|(own, _)| own == fit)
    });
    if let Some((_, entry)) = head {
        parts.push(entry.off);
    }
    parts
}

/// Garment `name` worn by a mannequin of its fit, as a GLB (kept with the characters' looks).
pub fn garment_glb(game_root: &Path, work_dir: &Path, name: &str) -> Result<PathBuf> {
    let name = name.to_ascii_lowercase();
    let index = parts_index(game_root, work_dir, |_, _, _| {})?;
    let entry = drawables(&index)
        .get(&name)
        .map(|entry| entry.off)
        .with_context(|| format!("no garment {name} in {CHARACTER_PARTS}"))?;
    let (fit, _) = fit_of(&name).with_context(|| format!("{name} has no fit tag"))?;
    let mut parts = mannequin(&index, fit);
    parts.push(entry);
    character_glb(
        game_root,
        work_dir,
        &format!("mannequin_{fit}"),
        Some(&parts),
        None,
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_garment_names() {
        assert_eq!(label_of("jackettrack"), "jacket track");
        assert_eq!(label_of("pants"), "pants");
        assert_eq!(fit_of("tshirtcrewneck_mr1_004_full"), Some(("mr1", "004")));
        assert_eq!(fit_of("prop_bench_01"), None);
    }

    #[test]
    fn needs_the_character_parts() {
        let root = std::env::temp_dir().join(format!("openvi-clothes-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let list = garment_list(&root, &root.join("work"), |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(list.unwrap_err().to_string().contains(CHARACTER_PARTS));
    }

    #[test]
    fn lists_no_garments_where_there_are_none() {
        let root = std::env::temp_dir().join(format!("openvi-clothes-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(CHARACTER_PARTS), crate::fixtures::archive().0).unwrap();
        let list = garment_list(&root, &root.join("work"), |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(list.unwrap().is_empty());
    }
}
