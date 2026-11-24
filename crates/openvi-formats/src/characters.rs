//! Characters and animals: the ones SixNG can assemble from their parts in `packs.rpf`, their parts, and one
//! assembled into a rigged GLB (its parts skinned to one skeleton, the head's face applied).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sixng_core::export::Workspace;
use sixng_core::outfit;
use sixng_core::scan::ArchiveIndex;

use crate::model::{options, stores_version, version};
use crate::{ScanPhase, scan_archive};

/// The archive holding the character and animal parts.
pub const CHARACTER_PARTS: &str = "packs.rpf";

/// A character or an animal SixNG can assemble.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    /// Its name prefix (`player_story000_00`, `crb_deer_whitetailed_m_00`): the id.
    pub name: String,
    /// `character` or `animal`.
    pub kind: String,
    /// Parts it has, and how many of them it wears by default.
    pub parts: usize,
    pub default_parts: usize,
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
) -> Result<(Workspace, ArchiveIndex)> {
    let path = game_root.join(CHARACTER_PARTS);
    ensure!(path.is_file(), "{} has no {CHARACTER_PARTS}", game_root.display());
    let workspace = Workspace::new(game_root, work_dir);
    scan_archive(&path, CHARACTER_PARTS, &workspace.index_dir(), progress)?;
    let index = workspace.load_index(&workspace.resolve(CHARACTER_PARTS)?)?;
    Ok((workspace, index))
}

/// Every character and animal of the game, by name. Scans `packs.rpf` first if needed.
pub fn character_list(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Vec<Character>> {
    let (_, index) = parts_index(game_root, work_dir, progress)?;
    Ok(outfit::characters(&index)
        .into_iter()
        .map(|info| Character {
            name: info.name,
            kind: info.kind.into(),
            parts: info.parts,
            default_parts: info.default_parts,
        })
        .collect())
}

fn options_of(index: &ArchiveIndex, name: &str) -> Vec<outfit::PartOpt> {
    let name = name.to_ascii_lowercase();
    if outfit::is_animal(&name) {
        outfit::animal_options(index, &name)
    } else {
        outfit::outfit_options(index, &name)
    }
}

/// The parts character `name` can wear, by group.
pub fn character_parts(game_root: &Path, work_dir: &Path, name: &str) -> Result<Vec<CharacterPart>> {
    let (_, index) = parts_index(game_root, work_dir, |_, _, _| {})?;
    let mut parts: Vec<CharacterPart> = options_of(&index, name)
        .into_iter()
        .map(|option| CharacterPart {
            offset: option.off,
            name: option.name,
            group: option.group,
            label: option.label,
            default: option.default,
        })
        .collect();
    ensure!(!parts.is_empty(), "{name} has no parts in {CHARACTER_PARTS}");
    parts.sort_by(|a, b| (&a.group, !a.default, &a.label).cmp(&(&b.group, !b.default, &b.label)));
    Ok(parts)
}

/// Character `name` assembled as one rigged GLB, wearing `parts` (offsets from [`character_parts`]) or, when `None`,
/// its default look. Kept in `<work>/characters` and reused until `packs.rpf` or a texture store changes.
pub fn character_glb(game_root: &Path, work_dir: &Path, name: &str, parts: Option<&[u64]>) -> Result<PathBuf> {
    let name = name.to_ascii_lowercase();
    let (_, index) = parts_index(game_root, work_dir, |_, _, _| {})?;
    let available = options_of(&index, &name);
    let mut chosen: Vec<u64> = match parts {
        Some(parts) => parts.to_vec(),
        None => available.iter().filter(|o| o.default).map(|o| o.off).collect(),
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

    // One folder per look: the parts' offsets name it.
    let look = chosen.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, offset| {
        (hash ^ offset).wrapping_mul(0x0100_0000_01b3)
    });
    let sources = format!(
        "{}_{}",
        version(&game_root.join(CHARACTER_PARTS)),
        stores_version(game_root)
    );
    let out = work_dir
        .join("characters")
        .join(sources)
        .join(format!("{name}_{look:016x}"))
        .join(format!("{name}.glb"));
    if out.is_file() {
        return Ok(out);
    }
    let archive = Workspace::new(game_root, work_dir).resolve(CHARACTER_PARTS)?;
    let folder = out.parent().context("character export path has no folder")?;
    outfit::export_outfit(
        &archive,
        &selection,
        &name,
        &out,
        &options(folder, true)?,
        &[],
        false,
        false,
    )?;
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
        let glb = character_glb(&root, &root.join("work"), "player_story000_00", None);
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
