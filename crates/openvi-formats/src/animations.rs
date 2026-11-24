//! Animation clips: the clip dictionaries of `anim.rpf` and the clips each holds. A clip plays on a character through
//! [`crate::characters::character_glb`].

use std::path::Path;

use anyhow::{Result, ensure};
use serde::Serialize;
use sixng_core::resource::Resource;
use sixng_core::{anim, classify};

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
    naming: impl Fn(u64, u64) + Sync,
) -> Result<Vec<ClipDictionary>> {
    scan_animations(game_root, work_dir, progress)?;
    let cache = work_dir.join("index").join(anim::DICT_CACHE);
    if cache.is_file() && stale(&cache, &[game_root.join(ANIMATIONS)]) {
        std::fs::remove_file(&cache)?;
    }
    let entries = match std::fs::read(&cache)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<anim::DictEntry>>(&bytes).ok())
    {
        Some(cached) => cached,
        None => {
            let entries = read_dictionary_names(game_root, work_dir, &naming)?;
            // The same file and format SixNG reads back (`anim::dictionaries`, `load_dictionary`).
            std::fs::write(&cache, serde_json::to_vec(&entries)?)?;
            entries
        }
    };
    let mut dictionaries: Vec<ClipDictionary> = entries
        .into_iter()
        .map(|entry| ClipDictionary {
            name: entry.name,
            id: entry.id,
        })
        .collect();
    dictionaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(dictionaries)
}

/// The name of every clip dictionary of `anim.rpf`, as `anim::dictionaries` reads them (each candidate's system page),
/// counting the candidates read through `naming(done, total)`.
fn read_dictionary_names(
    game_root: &Path,
    work_dir: &Path,
    naming: &(impl Fn(u64, u64) + Sync),
) -> Result<Vec<anim::DictEntry>> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    let index = crate::index_cache::load(&work_dir.join("index"), ANIMATIONS)?;
    let archive = game_root.join(ANIMATIONS);
    let candidates: Vec<_> = index
        .entries
        .iter()
        .filter(|entry| entry.kind == classify::Kind::RageObj && !entry.streams.is_empty())
        .collect();
    let total = candidates.len() as u64;
    let done = AtomicU64::new(0);
    naming(0, total);
    let mut entries: Vec<anim::DictEntry> = candidates
        .par_iter()
        .filter_map(|entry| {
            let name = Resource::load_sys(&archive, entry)
                .ok()
                .and_then(|resource| anim::dictionary_name(&resource.sys));
            let count = done.fetch_add(1, Ordering::Relaxed) + 1;
            if count.is_multiple_of(64) || count == total {
                naming(count, total);
            }
            Some(anim::DictEntry {
                name: name?,
                id: entry.id.clone(),
            })
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    Ok(entries)
}

/// Clip dictionary `dictionary` (its name or id), kept in memory: picking clip after clip of one dictionary reads it once.
/// Only the last one is kept (they run to megabytes); it is read again when `anim.rpf` changes.
pub(crate) fn load_dictionary(
    game_root: &Path,
    work_dir: &Path,
    dictionary: &str,
) -> Result<std::sync::Arc<anim::ClipDictionary>> {
    use std::sync::{Arc, Mutex, OnceLock, PoisonError};

    type Last = Mutex<Option<(String, String, Arc<anim::ClipDictionary>)>>;
    static LAST: OnceLock<Last> = OnceLock::new();
    let last = LAST.get_or_init(Mutex::default);
    let state = crate::model::version(&game_root.join(ANIMATIONS));
    if let Some((name, seen, loaded)) = last.lock().unwrap_or_else(PoisonError::into_inner).as_ref()
        && name == dictionary
        && *seen == state
    {
        return Ok(Arc::clone(loaded));
    }
    let loaded = Arc::new(anim::load_dictionary(game_root, work_dir, dictionary)?.1);
    *last.lock().unwrap_or_else(PoisonError::into_inner) = Some((dictionary.to_owned(), state, Arc::clone(&loaded)));
    Ok(loaded)
}

/// The clips of dictionary `dictionary` (its name or its id).
pub fn clip_list(game_root: &Path, work_dir: &Path, dictionary: &str) -> Result<Vec<Clip>> {
    scan_animations(game_root, work_dir, |_, _, _| {})?;
    let loaded = load_dictionary(game_root, work_dir, dictionary)?;
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
        let result = clip_dictionaries(&root, &root.join("work"), |_, _, _| {}, |_, _| {});
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
        let dictionaries = clip_dictionaries(&root, &work, |_, _, _| {}, |_, _| {});
        let clips = clip_list(&root, &work, "gameplay@locomotion@walk");
        std::fs::remove_dir_all(&root).unwrap();

        assert!(dictionaries.unwrap().is_empty());
        assert!(clips.is_err());
    }
}
