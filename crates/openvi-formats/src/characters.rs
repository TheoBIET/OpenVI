//! Characters and animals: the ones SixNG can assemble from their parts in `packs.rpf`, every ped model of the
//! game's outfit list, their parts and outfits, and one assembled into a rigged GLB (its parts skinned to one
//! skeleton, the head's face applied).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sixng_core::export::Workspace;
use sixng_core::game::ArchiveInfo;
use sixng_core::scan::ArchiveIndex;
use sixng_core::{anim, outfit, pedlook};

use crate::animations::{ANIMATIONS, scan_animations};
use crate::model::{options, stores_version, version};
use crate::{ScanPhase, scan_archive};

/// The archive holding the character and animal parts.
pub const CHARACTER_PARTS: &str = "packs.rpf";

/// A character, an animal or a ped model SixNG can assemble.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    /// Its name prefix (`player_story000_00`, `crb_deer_whitetailed_m_00`) or model name (`cs_mandy`, or
    /// `ped_0x<hash>` when no name is known): the id.
    pub name: String,
    /// `character` (parts named after it), `animal`, or `model` (a ped model of the outfit list, dressed from it).
    pub kind: String,
    /// Parts named after it, and how many of them it wears by default (0 for a model: its outfits dress it).
    pub parts: usize,
    pub default_parts: usize,
    /// The name the game shows ("Mandy"), where the data gives one.
    pub display: Option<String>,
    /// Outfits the game's outfit list gives it.
    pub outfits: usize,
    /// The model name may be a chance hash hit.
    pub uncertain: bool,
}

/// One outfit of the game's outfit list, as the parts it wears.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterLook {
    /// Its main garments ("jacket track, pants track"), or its id.
    pub label: String,
    /// Offsets of its parts, among [`CharacterParts::parts`].
    pub parts: Vec<u64>,
}

/// What a character can wear: its parts by group, and the outfits the game dresses it in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterParts {
    pub parts: Vec<CharacterPart>,
    pub outfits: Vec<CharacterLook>,
}

/// One part a character can wear. Parts of one `group` replace each other: one per group, or none.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterPart {
    /// Offset of the part's model in `packs.rpf`: the handle [`character_glb`] takes.
    pub offset: u64,
    pub name: String,
    /// Slot: `head`, `hair`, `top`, `bottom`, `feet`... (for animals: the body part).
    pub group: String,
    pub label: String,
    /// Worn in the character's default look.
    pub default: bool,
}

/// The workspace and the scanned index of `packs.rpf` (scanned first if needed).
fn parts_index(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<(Workspace, std::sync::Arc<ArchiveIndex>)> {
    let path = game_root.join(CHARACTER_PARTS);
    ensure!(path.is_file(), "{} has no {CHARACTER_PARTS}", game_root.display());
    let workspace = Workspace::new(game_root, work_dir);
    scan_archive(&path, CHARACTER_PARTS, &workspace.index_dir(), progress)?;
    let index = crate::index_cache::load(&workspace.index_dir(), CHARACTER_PARTS)?;
    Ok((workspace, index))
}

/// Every character and animal of the game, by name, then every other ped model of the outfit list (named ones
/// first). Scans `packs.rpf` first if needed; display names need `data.rpf` scanned too.
pub fn character_list(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Vec<Character>> {
    let (_, index) = parts_index(game_root, work_dir, progress)?;
    // The ped models, when the outfit list decodes (a game without one still lists its characters).
    let models = pedlook::listed_models(game_root).unwrap_or_default();
    let mut list: Vec<Character> = outfit::characters(&index)
        .into_iter()
        .map(|info| {
            let model = models.iter().find(|model| model.name == info.name);
            Character {
                name: info.name,
                kind: info.kind.into(),
                parts: info.parts,
                default_parts: info.default_parts,
                display: model.and_then(|model| model.display.clone()),
                outfits: model.map_or(0, |model| model.outfits),
                uncertain: model.is_some_and(|model| model.uncertain),
            }
        })
        .collect();
    let listed: HashSet<String> = list.iter().map(|character| character.name.clone()).collect();
    list.extend(
        models
            .into_iter()
            .filter(|model| !listed.contains(&model.name))
            .map(|model| Character {
                name: model.name,
                kind: "model".into(),
                parts: 0,
                default_parts: 0,
                display: model.display,
                outfits: model.outfits,
                uncertain: model.uncertain,
            }),
    );
    Ok(list)
}

/// One part of an outfit: offset, group, drawable name, label.
type OutfitPart = (u64, String, String, String);

/// The outfits the game's outfit list dresses `name` in (the first is the one shown by default), each as its label
/// and the parts of `packs.rpf` it wears. A slot worn twice (two accessories) gets a numbered group, so each part
/// keeps its own. Empty when the list has no outfit for it.
fn outfits_of(
    game_root: &Path,
    archive: &ArchiveInfo,
    index: &ArchiveIndex,
    name: &str,
) -> Vec<(String, Vec<OutfitPart>)> {
    let Ok(look) = pedlook::look(game_root, archive, index, name) else {
        return Vec::new();
    };
    let wanted: HashSet<&str> = look
        .outfits
        .iter()
        .flat_map(|outfit| &outfit.parts)
        .filter(|part| !part.strands)
        .map(|part| part.drawable.as_str())
        .collect();
    // The LOD0 copy of each drawable the outfits name.
    let drawables = index.entries.iter().filter(|entry| entry.rtype.as_deref() == Some("dr"));
    let by_name = outfit::dedupe(drawables.filter_map(|entry| {
        let name = entry.name.as_ref()?.to_ascii_lowercase();
        wanted.contains(name.as_str()).then_some((name, entry))
    }));
    let mut outfits = Vec::new();
    for outfit in &look.outfits {
        let mut seen: HashMap<&str, usize> = HashMap::new();
        let mut parts = Vec::new();
        for part in outfit.parts.iter().filter(|part| !part.strands) {
            let Some(entry) = by_name.get(&part.drawable) else { continue };
            let count = seen.entry(part.slot.as_str()).or_default();
            *count += 1;
            let group = if *count == 1 {
                part.slot.clone()
            } else {
                format!("{} {count}", part.slot)
            };
            let label = pedlook::item_word(&part.drawable).to_string();
            parts.push((entry.off, group, part.drawable.clone(), label));
        }
        if parts.is_empty() {
            continue;
        }
        let label = if outfit.label.is_empty() {
            format!("outfit {}", outfit.id)
        } else {
            outfit.label.clone()
        };
        outfits.push((label, parts));
    }
    outfits
}

fn options_of(index: &ArchiveIndex, name: &str) -> Vec<outfit::PartOpt> {
    let name = name.to_ascii_lowercase();
    if outfit::is_animal(&name) {
        outfit::animal_options(index, &name)
    } else {
        outfit::outfit_options(index, &name)
    }
}

/// The outfits of the outfit list for `name`, none for an animal.
fn outfits_for(
    game_root: &Path,
    workspace: &Workspace,
    index: &ArchiveIndex,
    name: &str,
) -> Result<Vec<(String, Vec<OutfitPart>)>> {
    if outfit::is_animal(name) {
        return Ok(Vec::new());
    }
    let archive = workspace.resolve(CHARACTER_PARTS)?;
    Ok(outfits_of(game_root, &archive, index, name))
}

/// The parts character `name` can wear, by group, and the outfits the game dresses it in. A ped model with no parts
/// named after it wears the parts of its outfits; its first outfit is its default look.
pub fn character_parts(game_root: &Path, work_dir: &Path, name: &str) -> Result<CharacterParts> {
    let (workspace, index) = parts_index(game_root, work_dir, |_, _, _| {})?;
    let name = name.to_ascii_lowercase();
    let mut parts: Vec<CharacterPart> = options_of(&index, &name)
        .into_iter()
        .map(|option| CharacterPart {
            offset: option.off,
            name: option.name,
            group: option.group,
            label: option.label,
            default: option.default,
        })
        .collect();
    let own = !parts.is_empty();
    let outfits = outfits_for(game_root, &workspace, &index, &name)?;
    for (position, (_, worn)) in outfits.iter().enumerate() {
        for (offset, group, drawable, label) in worn {
            if parts.iter().any(|part| part.offset == *offset) {
                continue;
            }
            parts.push(CharacterPart {
                offset: *offset,
                name: drawable.clone(),
                group: group.clone(),
                label: label.clone(),
                default: !own && position == 0,
            });
        }
    }
    ensure!(!parts.is_empty(), "{name} has no parts in {CHARACTER_PARTS}");
    parts.sort_by(|a, b| (&a.group, !a.default, &a.label).cmp(&(&b.group, !b.default, &b.label)));
    let outfits = outfits
        .into_iter()
        .map(|(label, worn)| CharacterLook {
            label,
            parts: worn.into_iter().map(|(offset, ..)| offset).collect(),
        })
        .collect();
    Ok(CharacterParts { parts, outfits })
}

/// An animation clip to play on a character: `(dictionary name, clip name)`.
pub type ClipChoice<'a> = (&'a str, &'a str);

/// Character `name` assembled as one rigged GLB, wearing `parts` (offsets from [`character_parts`]) or, when `None`,
/// its default look; with `clip`, the clip as the GLB's animation, and with `skeleton_only` only the skeleton (no
/// meshes) to show the motion alone. Kept in `<work>/characters` and reused until `packs.rpf`, `anim.rpf` or a
/// texture store changes.
pub fn character_glb(
    game_root: &Path,
    work_dir: &Path,
    name: &str,
    parts: Option<&[u64]>,
    clip: Option<ClipChoice>,
    skeleton_only: bool,
) -> Result<PathBuf> {
    ensure!(
        !skeleton_only || clip.is_some(),
        "a skeleton alone needs a clip to show"
    );
    let name = name.to_ascii_lowercase();
    let (workspace, index) = parts_index(game_root, work_dir, |_, _, _| {})?;
    let mut chosen: Vec<u64> = match parts {
        Some(parts) => parts.to_vec(),
        None => {
            let own: Vec<u64> = options_of(&index, &name)
                .iter()
                .filter(|option| option.default)
                .map(|option| option.off)
                .collect();
            if own.is_empty() {
                // A ped model: its first outfit.
                let outfits = outfits_for(game_root, &workspace, &index, &name)?;
                outfits
                    .into_iter()
                    .next()
                    .map(|(_, worn)| worn.into_iter().map(|(offset, ..)| offset).collect())
                    .unwrap_or_default()
            } else {
                own
            }
        }
    };
    chosen.sort_unstable();
    chosen.dedup();
    ensure!(!chosen.is_empty(), "no parts chosen for {name}");
    let selection: Vec<_> = chosen
        .iter()
        .map(|offset| {
            index
                .entries
                .iter()
                .find(|entry| entry.off == *offset)
                .with_context(|| format!("no part at {offset:#x} in {CHARACTER_PARTS}"))
        })
        .collect::<Result<_>>()?;

    // One folder per look and clip: the parts' offsets and the clip name it.
    let fnv = |hash: u64, value: u64| (hash ^ value).wrapping_mul(0x0100_0000_01b3);
    let mut look = chosen
        .iter()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, offset| fnv(hash, *offset));
    if let Some((dictionary, name)) = clip {
        let text = format!("{dictionary}/{name}/{skeleton_only}");
        look = text.bytes().fold(look, |hash, byte| fnv(hash, u64::from(byte)));
    }
    let sources = format!(
        "{}_{}_{}",
        version(&game_root.join(CHARACTER_PARTS)),
        stores_version(game_root),
        if clip.is_some() {
            version(&game_root.join(ANIMATIONS))
        } else {
            "still".into()
        }
    );
    // Every look and clip of a character shares one folder, so the textures decoded for one are reused by the next
    // (exports do not force them again).
    let out = work_dir
        .join("characters")
        .join(sources)
        .join(&name)
        .join(format!("{look:016x}.glb"));
    if out.is_file() {
        return Ok(out);
    }
    let archive = workspace.resolve(CHARACTER_PARTS)?;
    let folder = out.parent().context("character export path has no folder")?;
    let dictionary = match clip {
        Some((dictionary, _)) => {
            scan_animations(game_root, work_dir, |_, _, _| {})?;
            Some(crate::animations::load_dictionary(game_root, work_dir, dictionary)?)
        }
        None => None,
    };
    let clips: Vec<(&anim::ClipDictionary, &anim::Clip)> = match (&dictionary, clip) {
        (Some(loaded), Some((_, wanted))) => {
            let found = loaded
                .clip(wanted)
                .with_context(|| format!("no clip {wanted} in {}", loaded.name))?;
            vec![(loaded.as_ref(), found)]
        }
        _ => Vec::new(),
    };
    // Without force, textures already decoded are kept; force only if that left no GLB.
    for force in [false, true] {
        outfit::export_outfit(
            &archive,
            &selection,
            &name,
            &out,
            &options(folder, force)?,
            &clips,
            skeleton_only,
            false,
        )?;
        if out.is_file() {
            break;
        }
    }
    ensure!(out.is_file(), "SixNG exported no GLB for {name}");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    /// A game folder whose `packs.rpf` is the synthetic archive: it has no character parts.
    fn game(test: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("openvi-characters-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(CHARACTER_PARTS), fixtures::archive().0).unwrap();
        root
    }

    #[test]
    fn lists_no_characters_where_there_are_none() {
        let root = game("list");
        let list = character_list(&root, &root.join("work"), |_, _, _| {});
        let parts = character_parts(&root, &root.join("work"), "player_story000_00");
        let glb = character_glb(&root, &root.join("work"), "player_story000_00", None, None, false);
        std::fs::remove_dir_all(&root).unwrap();

        assert!(list.unwrap().is_empty());
        assert!(parts.unwrap_err().to_string().contains("no parts"));
        assert!(glb.unwrap_err().to_string().contains("no parts chosen"));
    }

    #[test]
    fn needs_the_character_parts() {
        let root = std::env::temp_dir().join(format!("openvi-characters-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let list = character_list(&root, &root.join("work"), |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();

        assert!(list.unwrap_err().to_string().contains(CHARACTER_PARTS));
    }
}
