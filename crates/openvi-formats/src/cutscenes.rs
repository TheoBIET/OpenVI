//! Cutscenes: the scenes of the story pack (`pack/story000/story000.rpf`), their cast, props and cameras, and one cast
//! member playing the scene.
//!
//! `sixng_core::cutscene` finds the scenes' clip dictionaries and scene files by scanning the pack (cached in
//! `<work>/index`), and names the cast's models from the names of the indexed archives and the characters SixNG can
//! assemble. A scene's clips are cut in sections streamed in other dictionaries; [`cutscene_glb`] joins them
//! (`cutscene::load_dictionary`) and plays the whole scene on one character.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sixng_core::cutscene::{self, STORY_ARCHIVE};
use sixng_core::export::Workspace;

use crate::characters::{CHARACTER_PARTS, ClipSource, assemble};
use crate::{ScanPhase, scan_archive};

/// One object of a scene.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneMember {
    /// Its handle in the scene (`lucia`, `prop_am_drink_soda_03a`).
    pub handle: String,
    /// `character` (one OpenVI can assemble and play the scene on), `ped`, `prop` or `unknown`.
    pub kind: String,
    pub model: Option<String>,
    /// Its body clips (short names).
    pub clips: Vec<String>,
}

/// One cutscene.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cutscene {
    pub name: String,
    /// The scene this one is a variant of.
    pub variant_of: Option<String>,
    /// Camera cuts.
    pub sections: usize,
    pub cast: Vec<SceneMember>,
    pub props: Vec<SceneMember>,
    pub cameras: usize,
    /// Set dressing the scene spawns or drives (models resolved by name).
    pub set_models: Vec<String>,
    /// Clip windows whose animation is in none of the section dictionaries (an incomplete pack): parts of the scene
    /// will not move.
    pub missing: usize,
}

fn member(object: &cutscene::SceneObject) -> SceneMember {
    SceneMember {
        handle: object.handle.clone(),
        kind: object.kind.to_string(),
        model: object.model.clone(),
        clips: object.clips.clone(),
    }
}

/// The scene catalog of the story pack (scanned first if needed) and the workspace.
fn catalog(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<(Workspace, cutscene::Catalog)> {
    let path = game_root.join(STORY_ARCHIVE);
    ensure!(path.is_file(), "{} has no {STORY_ARCHIVE}", game_root.display());
    let workspace = Workspace::new(game_root, work_dir);
    scan_archive(&path, STORY_ARCHIVE, &workspace.index_dir(), progress)?;
    let catalog = cutscene::catalog(&workspace, STORY_ARCHIVE, false, Arc::new(|_, _, _| {}))?;
    Ok((workspace, catalog))
}

type Loaded = (String, Arc<Vec<Cutscene>>);

/// Every cutscene of the story pack, by name. Scans the pack first if needed, and `packs.rpf` for the cast's names.
/// Kept in memory until the pack changes (naming the cast reads every indexed archive's names).
pub fn cutscene_list(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Arc<Vec<Cutscene>>> {
    static MEMORY: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    let (workspace, catalog) = catalog(game_root, work_dir, progress)?;
    let state = crate::model::version(&game_root.join(STORY_ARCHIVE));
    let memory = MEMORY.get_or_init(Default::default);
    if let Some((known, scenes)) = memory.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref()
        && *known == state
    {
        return Ok(Arc::clone(scenes));
    }
    let scenes = Arc::new(list(&workspace, &catalog, work_dir));
    *memory.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((state, Arc::clone(&scenes)));
    Ok(scenes)
}

fn list(workspace: &Workspace, catalog: &cutscene::Catalog, work_dir: &Path) -> Vec<Cutscene> {
    let mut models = cutscene::Models::default();
    for archive in workspace.archives() {
        if !workspace.is_indexed(&archive) {
            continue;
        }
        let Ok(index) = crate::index_cache::load(&workspace.index_dir(), &archive.id) else {
            continue;
        };
        if archive.id == CHARACTER_PARTS {
            let characters = sixng_core::outfit::characters(&index);
            models.add_characters(
                characters
                    .iter()
                    .filter(|character| character.kind == "character")
                    .map(|character| character.name.as_str()),
            );
        }
        models.add_index(&index);
    }
    models.add_name_dict(work_dir);
    let mut scenes: Vec<Cutscene> = cutscene::scenes(catalog, &models)
        .into_iter()
        .map(|scene| Cutscene {
            name: scene.name,
            variant_of: scene.variant_of,
            sections: scene.sections,
            cast: scene.cast.iter().map(member).collect(),
            props: scene.props.iter().map(member).collect(),
            cameras: scene.cameras.len(),
            set_models: scene.set_models,
            missing: scene.windows_missing,
        })
        .collect();
    scenes.sort_by(|a, b| a.name.cmp(&b.name));
    scenes
}

/// Cast member `handle` of scene `scene` playing it, as a GLB: its model (a character, default look) with its body
/// clip, the scene's sections joined. Kept with the characters' looks.
pub fn cutscene_glb(game_root: &Path, work_dir: &Path, scene: &str, handle: &str) -> Result<PathBuf> {
    let (workspace, catalog) = catalog(game_root, work_dir, |_, _, _| {})?;
    let wanted = scene.strip_prefix("cin@").unwrap_or(scene);
    let dictionary = catalog
        .dicts
        .iter()
        .find(|dictionary| {
            cutscene::parse_dict_name(&dictionary.name)
                .is_some_and(|(name, section)| section.is_none() && name.eq_ignore_ascii_case(wanted))
        })
        .with_context(|| format!("no cutscene {wanted} in {STORY_ARCHIVE}"))?;
    let clip = dictionary
        .clips
        .iter()
        .find(|clip| {
            let (own, _, face) = cutscene::split_clip_name(clip);
            !face && own.eq_ignore_ascii_case(handle)
        })
        .with_context(|| format!("{handle} has no clip in {wanted}"))?
        .clone();
    let models = cutscene_list(game_root, work_dir, |_, _, _| {})?;
    let model = models
        .iter()
        .find(|candidate| candidate.name.eq_ignore_ascii_case(wanted))
        .and_then(|found| {
            found
                .cast
                .iter()
                .find(|member| member.handle.eq_ignore_ascii_case(handle))
        })
        .and_then(|member| member.model.clone())
        .with_context(|| format!("the model of {handle} in {wanted} is not known"))?;
    let loaded = cutscene::load_dictionary(&workspace, &catalog, dictionary)?;
    assemble(
        game_root,
        work_dir,
        &model,
        None,
        Some(ClipSource::Loaded {
            dictionary: &loaded,
            clip: &clip,
            archive: &game_root.join(STORY_ARCHIVE),
        }),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_story_pack() {
        let root = std::env::temp_dir().join(format!("openvi-cutscenes-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let list = cutscene_list(&root, &root.join("work"), |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(list.unwrap_err().to_string().contains("story000"));
    }
}
