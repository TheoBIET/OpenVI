//! The Weapons section: every weapon, its parts, and one assembled from the parts chosen.

use std::path::{Path, PathBuf};

use anyhow::Result;
use openvi_formats::weapons::{
    WEAPON_ARCHIVES, Weapon, WeaponAssembly, WeaponPart, weapon_assembly, weapon_list, weapon_parts,
};
use tauri::AppHandle;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

fn list(root: &Path, work: &Path, database: &Path, reporter: &Reporter) -> Result<Vec<Weapon>> {
    scan_all(root, work, database, &WEAPON_ARCHIVES, reporter)?;
    reporter.step("Listing the weapons…");
    weapon_list(root, work, |_, _, _, _| {})
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every weapon of the game folder `root`; scans `data.rpf` and `packs.rpf` first when needed (each step as
/// `catalog-progress`).
#[tauri::command]
pub async fn weapons(app: AppHandle, root: PathBuf) -> Result<Vec<Weapon>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    blocking(move || list(&root, &work, &database, &reporter)).await
}

/// The parts weapon `name` can be built with.
#[tauri::command]
pub async fn weapon_part_list(app: AppHandle, root: PathBuf, name: String) -> Result<Vec<WeaponPart>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || weapon_parts(&root, &work, &name)).await
}

/// Weapon `name` built with `parts` (offsets), or its default build when `parts` is null: the manifest the 3D view
/// loads.
#[tauri::command]
pub async fn weapon_preview(
    app: AppHandle,
    root: PathBuf,
    name: String,
    parts: Option<Vec<u64>>,
) -> Result<WeaponAssembly, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let reporter = Reporter::new(app);
    blocking(move || {
        reporter.step(format!("Assembling {name}…"));
        weapon_assembly(&root, &work, &name, parts.as_deref())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_weapon_archives() {
        let root = std::env::temp_dir().join(format!("openvi-weapons-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = list(
            &root,
            &root.join("work"),
            &root.join("index.sqlite"),
            &Reporter::silent(),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains("data.rpf"));
    }
}
