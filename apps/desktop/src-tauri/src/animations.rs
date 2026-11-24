//! The Animations section: the clip dictionaries of `anim.rpf` and their clips. A clip plays on a character through
//! `character_preview`.

use std::path::{Path, PathBuf};

use anyhow::Result;
use openvi_formats::animations::{ANIMATIONS, Clip, ClipDictionary, clip_dictionaries, clip_list};
use tauri::AppHandle;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

fn dictionaries(root: &Path, work: &Path, database: &Path, reporter: &Reporter) -> Result<Vec<ClipDictionary>> {
    scan_all(root, work, database, &[ANIMATIONS], reporter)?;
    reporter.step("Listing the clip dictionaries…");
    // The first listing reads every dictionary's name: counted, then cached.
    clip_dictionaries(
        root,
        work,
        |_, _, _| {},
        |done, total| {
            reporter.count("Reading the clip dictionaries' names", done, total);
        },
    )
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every clip dictionary of the game folder `root`; scans `anim.rpf` first when needed (each step as
/// `catalog-progress`).
#[tauri::command]
pub async fn animation_dictionaries(app: AppHandle, root: PathBuf) -> Result<Vec<ClipDictionary>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    blocking(move || dictionaries(&root, &work, &database, &reporter)).await
}

/// The clips of `dictionary` (its name or id).
#[tauri::command]
pub async fn animation_clips(app: AppHandle, root: PathBuf, dictionary: String) -> Result<Vec<Clip>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || clip_list(&root, &work, &dictionary)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_animation_archive() {
        let root = std::env::temp_dir().join(format!("openvi-animations-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = dictionaries(
            &root,
            &root.join("work"),
            &root.join("index.sqlite"),
            &Reporter::silent(),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains(ANIMATIONS));
    }
}
