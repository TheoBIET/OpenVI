//! One resource of an archive: its details and texture previews, for the properties panel.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use openvi_formats::{ResourceDetails, TextPreview, resource_details, resource_text, texture_png};
use tauri::AppHandle;
use tauri::ipc::Response;

use crate::fs::{Located, is_archive, locate};
use crate::index;

/// Largest side of a texture preview, in pixels.
const PREVIEW_SIZE: u32 = 1024;

/// Most bytes of a text resource the viewer shows.
const TEXT_LIMIT: usize = 512 * 1024;

/// The archive inside `root` and the offset a resource path (`<archive>#<offset in hex>`) points at.
fn resolve(root: &Path, resource: &str) -> Result<(PathBuf, String, u64)> {
    let (archive, offset) = resource
        .rsplit_once('#')
        .with_context(|| format!("{resource} is not a resource path"))?;
    let offset = u64::from_str_radix(offset, 16).with_context(|| format!("bad offset in {resource}"))?;
    let Located { path, relative, .. } = locate(root, Path::new(archive))?;
    ensure!(
        path.is_file() && is_archive(&path),
        "{} is not an archive",
        path.display()
    );
    Ok((path, relative, offset))
}

fn details(root: &Path, cache: &Path, resource: &str) -> Result<ResourceDetails> {
    let (archive, relative, offset) = resolve(root, resource)?;
    resource_details(&archive, &relative, cache, offset)
}

fn preview(root: &Path, cache: &Path, resource: &str, texture: usize) -> Result<Vec<u8>> {
    let (archive, relative, offset) = resolve(root, resource)?;
    texture_png(&archive, &relative, cache, offset, texture, PREVIEW_SIZE)
}

fn text(root: &Path, cache: &Path, resource: &str) -> Result<TextPreview> {
    let (archive, relative, offset) = resolve(root, resource)?;
    resource_text(&archive, &relative, cache, offset, TEXT_LIMIT)
}

/// Details of the resource at `path` (`<archive>#<offset>`), which must be inside `root`.
#[tauri::command]
pub async fn resource_info(app: AppHandle, root: PathBuf, path: String) -> Result<ResourceDetails, String> {
    let cache = index::cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || details(&root, &cache, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Texture `texture` of the resource at `path`, as PNG bytes.
#[tauri::command]
pub async fn texture_preview(app: AppHandle, root: PathBuf, path: String, texture: usize) -> Result<Response, String> {
    let cache = index::cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || preview(&root, &cache, &path, texture))
        .await
        .map_err(|error| error.to_string())?
        .map(Response::new)
        .map_err(|error| format!("{error:#}"))
}

/// The text of the XML or plain-text resource at `path`, cut at [`TEXT_LIMIT`].
#[tauri::command]
pub async fn resource_text_preview(app: AppHandle, root: PathBuf, path: String) -> Result<TextPreview, String> {
    let cache = index::cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || text(&root, &cache, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use openvi_formats::{fixtures, scan_archive};

    use super::*;

    /// A game folder with a scanned synthetic `common.rpf`; returns the folder, the cache and the resource offsets.
    fn game_folder(test: &str) -> (PathBuf, PathBuf, Vec<u64>) {
        let root = std::env::temp_dir().join(format!("openvi-resource-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(root.join("common.rpf"), bytes).unwrap();
        let cache = root.join(".cache");
        scan_archive(&root.join("common.rpf"), "common.rpf", &cache, |_, _, _| {}).unwrap();
        (root, cache, offsets)
    }

    fn resource_path(root: &Path, offset: u64) -> String {
        format!("{}#{offset:x}", root.join("common.rpf").display())
    }

    #[test]
    fn describes_a_resource_and_previews_its_texture() {
        let (root, cache, offsets) = game_folder("details");
        let path = resource_path(&root, offsets[4]);
        let info = details(&root, &cache, &path);
        let png = preview(&root, &cache, &path, 0);
        std::fs::remove_dir_all(&root).unwrap();

        let info = info.unwrap();
        assert_eq!(info.entry.name.as_deref(), Some(fixtures::DICTIONARY_NAME));
        assert_eq!(info.textures.len(), 1);
        assert!(png.unwrap().starts_with(b"\x89PNG"));
    }

    #[test]
    fn reads_a_text_resource() {
        let (root, cache, offsets) = game_folder("text");
        let xml = text(&root, &cache, &resource_path(&root, offsets[2]));
        std::fs::remove_dir_all(&root).unwrap();

        assert!(xml.unwrap().text.contains("<vehicles>"));
    }

    #[test]
    fn refuses_resources_outside_the_game_folder_and_bad_paths() {
        let (root, cache, offsets) = game_folder("refuse");
        std::fs::create_dir_all(root.join("pack")).unwrap();
        let outside = details(&root.join("pack"), &cache, &resource_path(&root, offsets[4]));
        let no_offset = details(&root, &cache, &root.join("common.rpf").display().to_string());
        let bad_offset = details(&root, &cache, &format!("{}#zz", root.join("common.rpf").display()));
        std::fs::remove_dir_all(&root).unwrap();

        assert!(outside.is_err());
        assert!(no_offset.is_err());
        assert!(bad_offset.is_err());
    }
}
