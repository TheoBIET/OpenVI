//! Directory listings for the explorer, confined to the game folder the user opened.

use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// One directory as the explorer shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    path: PathBuf,
    /// From the game folder down to `path`, for the breadcrumb.
    crumbs: Vec<Crumb>,
    /// Folders first, then archives, then other files; by name within each.
    entries: Vec<Entry>,
}

#[derive(Debug, Serialize)]
pub struct Crumb {
    name: String,
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: PathBuf,
    kind: EntryKind,
    /// Bytes on disk; 0 for folders.
    size: u64,
    /// Direct children of a folder; `None` for files or unreadable folders.
    items: Option<u64>,
}

/// Declaration order is the explorer's sort order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Folder,
    Archive,
    File,
}

/// Lists `path`, which must be `root` or inside it.
#[tauri::command]
pub async fn list_dir(root: PathBuf, path: PathBuf) -> Result<Listing, String> {
    tauri::async_runtime::spawn_blocking(move || listing(&root, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn listing(root: &Path, path: &Path) -> io::Result<Listing> {
    let root = dunce::canonicalize(root)?;
    let path = dunce::canonicalize(path)?;
    let relative = path.strip_prefix(&root).map_err(|_| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "this path is outside the opened game folder",
        )
    })?;

    let mut crumbs = vec![Crumb {
        name: game_name(&root).map_or_else(|| display_name(&root), str::to_owned),
        path: root.clone(),
    }];
    let mut at = root.clone();
    for part in relative.components() {
        at.push(part);
        crumbs.push(Crumb {
            name: part.as_os_str().to_string_lossy().into_owned(),
            path: at.clone(),
        });
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // `file_type` does not follow symbolic links: links are left out, so a link loop cannot hang the tree.
        let file_type = entry.file_type()?;
        let entry_path = entry.path();
        if file_type.is_dir() {
            let items = std::fs::read_dir(&entry_path)
                .ok()
                .map(|children| children.count() as u64);
            entries.push(Entry {
                name,
                path: entry_path,
                kind: EntryKind::Folder,
                size: 0,
                items,
            });
        } else if file_type.is_file() {
            let kind = if is_archive(&entry_path) {
                EntryKind::Archive
            } else {
                EntryKind::File
            };
            entries.push(Entry {
                name,
                path: entry_path,
                kind,
                size: entry.metadata()?.len(),
                items: None,
            });
        }
    }
    entries.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Listing { path, crumbs, entries })
}

/// Top-level archives every GTA VI install ships. Only names are checked: no file is opened.
const GTA_VI_SIGNATURE: [&str; 3] = ["common.rpf", "levels.rpf", "packs.rpf"];

/// The game installed in `root`, recognised by the archive names at its top level.
fn game_name(root: &Path) -> Option<&'static str> {
    GTA_VI_SIGNATURE
        .iter()
        .all(|name| root.join(name).is_file())
        .then_some("GTA VI")
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn is_archive(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("rpf"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway game folder: `pack/`, `x64/`, `common.rpf`, `eboot.bin`, `.DS_Store`.
    fn game_folder(test: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("openvi-{test}-{}", std::process::id()));
        std::fs::create_dir_all(root.join("pack").join("story000")).unwrap();
        std::fs::create_dir_all(root.join("x64")).unwrap();
        std::fs::write(root.join("common.rpf"), [0u8; 12]).unwrap();
        std::fs::write(root.join("eboot.bin"), [0u8; 3]).unwrap();
        std::fs::write(root.join(".DS_Store"), [0u8; 1]).unwrap();
        root
    }

    #[test]
    fn lists_folders_then_archives_then_files() {
        let root = game_folder("order");
        let result = listing(&root, &root);
        std::fs::remove_dir_all(&root).unwrap();

        let listing = result.unwrap();
        let names: Vec<_> = listing.entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["pack", "x64", "common.rpf", "eboot.bin"]);
        assert_eq!(listing.entries[0].items, Some(1));
        assert_eq!(listing.entries[2].kind, EntryKind::Archive);
        assert_eq!(listing.entries[2].size, 12);
    }

    #[test]
    fn crumbs_lead_from_the_game_folder_down() {
        let root = game_folder("crumbs");
        let result = listing(&root, &root.join("pack").join("story000"));
        std::fs::remove_dir_all(&root).unwrap();

        let crumbs: Vec<_> = result.unwrap().crumbs.into_iter().map(|crumb| crumb.name).collect();
        assert_eq!(crumbs[1..], ["pack", "story000"]);
    }

    #[test]
    fn names_a_gta_vi_install_after_the_game() {
        let root = game_folder("game");
        let plain = listing(&root, &root).map(|listing| listing.crumbs[0].name.clone());
        std::fs::write(root.join("levels.rpf"), [0u8; 1]).unwrap();
        std::fs::write(root.join("packs.rpf"), [0u8; 1]).unwrap();
        let result = listing(&root, &root.join("pack"));
        std::fs::remove_dir_all(&root).unwrap();

        assert!(plain.unwrap().starts_with("openvi-game-"));
        let crumbs: Vec<_> = result.unwrap().crumbs.into_iter().map(|crumb| crumb.name).collect();
        assert_eq!(crumbs, ["GTA VI", "pack"]);
    }

    #[test]
    fn refuses_paths_outside_the_game_folder() {
        let root = game_folder("outside");
        let result = listing(&root.join("pack"), &root);
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
    }
}
