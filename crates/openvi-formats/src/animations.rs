//! Animation clips: the clip dictionaries of `anim.rpf` and the clips each holds. A clip plays on a character through
//! [`crate::characters::character_glb`].

use std::path::Path;

use anyhow::{Result, ensure};
use serde::Serialize;
use sixng_core::anim;

use crate::model::stale;
use crate::{ScanPhase, scan_archive};

/// The archive holding the animation clips.
pub const ANIMATIONS: &str = "anim.rpf";

/// One clip dictionary (`gameplay@locomotion@female_character@...`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDictionary {
    pub name: String,
    /// Where it is (`anim.rpf@<offset>`).
    pub id: String,
}

/// One clip of a dictionary (`move`, `idle`...).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub name: String,
    /// Seconds.
    pub duration: f32,
}

/// Scans `anim.rpf` into `<work>/index` if needed.
pub(crate) fn scan_animations(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<()> {
    let path = game_root.join(ANIMATIONS);
    ensure!(path.is_file(), "{} has no {ANIMATIONS}", game_root.display());
    scan_archive(&path, ANIMATIONS, &work_dir.join("index"), progress)?;
    Ok(())
}

/// Every clip dictionary, by name. Scans `anim.rpf` first if needed; the first listing reads each dictionary's name
/// (about a minute) and is cached until `anim.rpf` changes.
pub fn clip_dictionaries(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Vec<ClipDictionary>> {
    scan_animations(game_root, work_dir, progress)?;
    let cache = work_dir.join("index").join(anim::DICT_CACHE);
    if cache.is_file() && stale(&cache, &[game_root.join(ANIMATIONS)]) {
        std::fs::remove_file(&cache)?;
    }
    let mut dictionaries: Vec<ClipDictionary> = anim::dictionaries(game_root, work_dir)?
        .into_iter()
        .map(|entry| ClipDictionary {
            name: entry.name,
            id: entry.id,
        })
        .collect();
    dictionaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(dictionaries)
}

/// The clips of dictionary `dictionary` (its name or its id).
pub fn clip_list(game_root: &Path, work_dir: &Path, dictionary: &str) -> Result<Vec<Clip>> {
    scan_animations(game_root, work_dir, |_, _, _| {})?;
    let (_, loaded) = anim::load_dictionary(game_root, work_dir, dictionary)?;
    let mut clips: Vec<Clip> = loaded
        .clips
        .iter()
        .filter(|clip| !clip.short_name().is_empty())
        .map(|clip| Clip {
            name: clip.short_name().to_owned(),
            duration: clip.duration,
        })
        .collect();
    clips.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(clips)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    #[test]
    fn needs_the_animation_archive() {
        let root = std::env::temp_dir().join(format!("openvi-animations-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = clip_dictionaries(&root, &root.join("work"), |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains(ANIMATIONS));
    }

    #[test]
    fn finds_no_dictionaries_in_an_archive_without_clips() {
        let root = std::env::temp_dir().join(format!("openvi-animations-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(ANIMATIONS), fixtures::archive().0).unwrap();
        let work = root.join("work");
        let dictionaries = clip_dictionaries(&root, &work, |_, _, _| {});
        let clips = clip_list(&root, &work, "gameplay@locomotion@walk");
        std::fs::remove_dir_all(&root).unwrap();

        assert!(dictionaries.unwrap().is_empty());
        assert!(clips.is_err());
    }
}
