//! Data-mining catalogs of the game: vehicles for now.

use std::path::{Path, PathBuf};

use anyhow::{Result, ensure};
use openvi_formats::catalog::{VEHICLE_ARCHIVES, VehicleCatalog, vehicle_catalog};
use tauri::AppHandle;

use crate::progress::Reporter;
use crate::{index, scans};

/// Scans the archives `ids` of `root` that are there (one scan per archive at a time, recorded in the index),
/// reporting each step.
pub(crate) fn scan_all(
    root: &Path,
    work: &Path,
    database: &Path,
    ids: &[&'static str],
    reporter: &Reporter,
) -> Result<()> {
    for &id in ids {
        let path = root.join(id);
        if !path.is_file() {
            continue;
        }
        let scan = scans::scan_reported(&path, id, &work.join("index"), reporter)?;
        reporter.step(format!("Indexing {id}…"));
        if let Err(error) = index::record(database, &path, id, &scan) {
            eprintln!("could not index {id}: {error:#}");
        }
    }
    Ok(())
}

/// Scans the archives the vehicle catalog needs, then builds it.
fn vehicles(root: &Path, work: &Path, database: &Path, reporter: &Reporter) -> Result<VehicleCatalog> {
    scan_all(root, work, database, &VEHICLE_ARCHIVES, reporter)?;
    // Every scan is cached now: this only decodes the tables.
    reporter.step("Decoding the vehicle tables, game text and handling records…");
    vehicle_catalog(root, work, |_, _, _, _| {})
}

/// The vehicle catalog of the game folder `root`, reporting each step (`catalog-progress`).
#[tauri::command]
pub async fn vehicle_list(app: AppHandle, root: PathBuf) -> Result<VehicleCatalog, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    tauri::async_runtime::spawn_blocking(move || vehicles(&root, &work, &database, &reporter))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

fn save(path: &Path, contents: &str) -> Result<()> {
    let extension = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase());
    ensure!(
        matches!(extension.as_deref(), Some("csv" | "json")),
        "exports are .csv or .json files"
    );
    std::fs::write(path, contents)?;
    Ok(())
}

/// Writes an export (CSV or JSON text) to `path`, a file the user picked in the save dialog.
#[tauri::command]
pub async fn save_export(path: PathBuf, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save(&path, &contents))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_only_csv_and_json() {
        let dir = std::env::temp_dir().join(format!("openvi-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let csv = save(&dir.join("vehicles.CSV"), "a,b\n");
        let exe = save(&dir.join("vehicles.exe"), "MZ");
        let written = std::fs::read_to_string(dir.join("vehicles.CSV"));
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(csv.is_ok() && exe.is_err());
        assert_eq!(written.unwrap(), "a,b\n");
    }

    #[test]
    fn needs_the_vehicle_tables() {
        let root = std::env::temp_dir().join(format!("openvi-catalog-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let result = vehicles(
            &root,
            &root.join("work"),
            &root.join("index.sqlite"),
            &Reporter::silent(),
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains("packs.rpf"));
    }
}
