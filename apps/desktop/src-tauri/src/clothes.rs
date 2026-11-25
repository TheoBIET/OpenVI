//! The Clothes section: every generic garment, and one tried on a mannequin of its fit.

use std::path::{Path, PathBuf};

use anyhow::Result;
use openvi_formats::characters::CHARACTER_PARTS;
use openvi_formats::clothes::{Garment, garment_glb, garment_list};
use tauri::AppHandle;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

fn list(root: &Path, work: &Path, database: &Path, reporter: &Reporter) -> Result<Vec<Garment>> {
    scan_all(root, work, database, &[CHARACTER_PARTS], reporter)?;
    reporter.step("Listing the clothes…");
    garment_list(root, work, |_, _, _| {})
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every generic garment of the game folder `root`; scans `packs.rpf` first when needed.
#[tauri::command]
pub async fn clothes(app: AppHandle, root: PathBuf) -> Result<Vec<Garment>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    blocking(move || list(&root, &work, &database, &reporter)).await
}

/// The GLB of garment `name` worn by a mannequin of its fit.
#[tauri::command]
pub async fn garment_preview(app: AppHandle, root: PathBuf, name: String) -> Result<PathBuf, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || garment_glb(&root, &work, &name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_character_parts() {
        let root = std::env::temp_dir().join(format!("openvi-clothes-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = list(
            &root,
            &root.join("work"),
            &root.join("index.sqlite"),
            &Reporter::silent(),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains(CHARACTER_PARTS));
    }
}
