//! Archive listings: the resources carved out of one `.rpf`, through the formats adapter.

use std::path::{Path, PathBuf};

use anyhow::{Result, ensure};
use openvi_formats::{ScanPhase, scan_archive};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::fs::{Entry, EntryKind, Listing, Located, is_archive, locate};
use crate::index;

/// Event sent while an archive is scanned for the first time.
pub const PROGRESS_EVENT: &str = "archive-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    /// The archive path as the frontend asked for it.
    archive: PathBuf,
    phase: ScanPhase,
    done: u64,
    total: u64,
}

/// Lists the resources of the archive at `path`, which must be inside `root`.
///
/// The first opening scans the archive and reports progress with [`PROGRESS_EVENT`]; the scan is cached in the
/// app's cache folder, so later openings answer at once.
#[tauri::command]
pub async fn open_archive(app: AppHandle, root: PathBuf, path: PathBuf) -> Result<Listing, String> {
    let cache = index::cache_dir(&app)?;
    let database = index::database(&app, &index::canonical_root(&root)?)?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = path.clone();
        archive_listing(&root, &path, &cache, Some(&database), move |phase, done, total| {
            let progress = ScanProgress {
                archive: archive.clone(),
                phase,
                done,
                total,
            };
            // A closed window cannot receive progress; the scan still finishes and is cached.
            let _ = app.emit(PROGRESS_EVENT, progress);
        })
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("{error:#}"))
}

fn archive_listing(
    root: &Path,
    path: &Path,
    cache: &Path,
    database: Option<&Path>,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Listing> {
    let Located { path, relative, crumbs } = locate(root, path)?;
    ensure!(
        path.is_file() && is_archive(&path),
        "{} is not an archive",
        path.display()
    );

    let scan = scan_archive(&path, &relative, cache, progress)?;
    if let Some(database) = database {
        // The listing does not depend on the index: a failure to record it only shows in the log.
        if let Err(error) = index::record(database, &path, &relative, &scan) {
            eprintln!("could not index {relative}: {error:#}");
        }
    }
    let mut entries: Vec<Entry> = scan
        .entries
        .iter()
        .map(|resource| Entry {
            // Unnamed resources go by their offset, the only stable handle the encrypted index leaves.
            name: resource
                .name
                .clone()
                .unwrap_or_else(|| format!("{:#x}", resource.offset)),
            path: PathBuf::from(format!("{}#{:x}", path.display(), resource.offset)),
            kind: EntryKind::Resource,
            size: resource.size,
            items: None,
            offset: Some(resource.offset),
            type_name: Some(resource.type_name().into()),
            location: None,
        })
        .collect();
    // By type, named resources by name, then unnamed ones by offset.
    entries.sort_by_cached_key(|entry| {
        let unnamed = entry.name.starts_with("0x");
        (
            entry.type_name.clone(),
            unnamed,
            if unnamed {
                String::new()
            } else {
                entry.name.to_lowercase()
            },
            entry.offset,
        )
    });

    Ok(Listing { path, crumbs, entries })
}

#[cfg(test)]
mod tests {
    use openvi_formats::fixtures;

    use super::*;

    /// A game folder holding a synthetic `common.rpf` and a plain file.
    fn game_folder(test: &str) -> (PathBuf, Vec<u64>) {
        let root = std::env::temp_dir().join(format!("openvi-archive-{test}-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(root.join("common.rpf"), bytes).unwrap();
        std::fs::write(root.join("eboot.bin"), [0u8; 3]).unwrap();
        (root, offsets)
    }

    #[test]
    fn lists_an_archive_by_type_with_recovered_names() {
        let (root, offsets) = game_folder("list");
        let result = archive_listing(&root, &root.join("common.rpf"), &root.join("cache"), None, |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();

        let listing = result.unwrap();
        let rows: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.type_name.as_deref().unwrap(),
                    entry.name.as_str(),
                    entry.offset.unwrap(),
                )
            })
            .collect();
        let dds = format!("{:#x}", offsets[0]);
        let png = format!("{:#x}", offsets[1]);
        let xml = format!("{:#x}", offsets[2]);
        assert_eq!(
            rows,
            [
                ("DDS Texture", dds.as_str(), offsets[0]),
                ("Fragment", fixtures::OBJECT_NAME, offsets[3]),
                ("PNG Image", png.as_str(), offsets[1]),
                ("Texture Dictionary", fixtures::DICTIONARY_NAME, offsets[4]),
                ("XML Document", xml.as_str(), offsets[2]),
            ]
        );
        assert!(listing.entries.iter().all(|entry| entry.kind == EntryKind::Resource));
        assert_eq!(
            listing.crumbs.last().map(|crumb| crumb.name.as_str()),
            Some("common.rpf")
        );
    }

    #[test]
    fn opening_an_archive_records_it_in_the_index() {
        let (root, _) = game_folder("record");
        let database = root.join("cache").join("index.sqlite");
        let listed = archive_listing(
            &root,
            &root.join("common.rpf"),
            &root.join("cache"),
            Some(&database),
            |_, _, _| {},
        );
        let found = openvi_index::Index::open(&database)
            .unwrap()
            .search(fixtures::OBJECT_NAME, 10);
        std::fs::remove_dir_all(&root).unwrap();

        assert!(listed.is_ok());
        let hits = found.unwrap().hits;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].archive, "common.rpf");
    }

    #[test]
    fn refuses_a_file_that_is_not_an_archive() {
        let (root, _) = game_folder("not-archive");
        let result = archive_listing(&root, &root.join("eboot.bin"), &root.join("cache"), None, |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.unwrap_err().to_string().contains("is not an archive"));
    }

    #[test]
    fn refuses_an_archive_outside_the_game_folder() {
        let (root, _) = game_folder("outside");
        std::fs::create_dir_all(root.join("pack")).unwrap();
        let result = archive_listing(
            &root.join("pack"),
            &root.join("common.rpf"),
            &root.join("cache"),
            None,
            |_, _, _| {},
        );
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.is_err());
    }
}
