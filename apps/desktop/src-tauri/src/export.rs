//! Exports to files the user picks: a resource as stored (inflated), a texture as PNG, a model or vehicle export.
//! Everything is written on the user's machine, for their own use (docs/LEGAL.md).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use openvi_formats::{resource_bytes, texture_png};
use tauri::AppHandle;

use crate::fs::{Located, is_archive, locate};
use crate::index;

/// The archive inside `root`, its id and the offset a resource path (`<archive>#<offset in hex>`) points at.
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

fn write_resource(root: &Path, cache: &Path, resource: &str, dest: &Path) -> Result<()> {
    let (archive, relative, offset) = resolve(root, resource)?;
    std::fs::write(dest, resource_bytes(&archive, &relative, cache, offset)?)?;
    Ok(())
}

fn write_texture(root: &Path, cache: &Path, resource: &str, texture: usize, dest: &Path) -> Result<()> {
    let (archive, relative, offset) = resolve(root, resource)?;
    // Full size: the largest mip.
    std::fs::write(
        dest,
        texture_png(&archive, &relative, cache, offset, texture, u32::MAX)?,
    )?;
    Ok(())
}

fn copy_tree(from: &Path, to: &Path) -> Result<usize> {
    std::fs::create_dir_all(to)?;
    let mut files = 0;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            files += copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
            files += 1;
        }
    }
    Ok(files)
}

/// Copies the folder of the GLB `glb` (which must be an export inside `work`) into `dest`, as `<dest>/<folder>`.
fn copy_model(work: &Path, glb: &Path, dest: &Path) -> Result<PathBuf> {
    let work = dunce::canonicalize(work)?;
    let glb = dunce::canonicalize(glb)?;
    ensure!(
        ["models", "vehicles", "characters"]
            .iter()
            .any(|folder| glb.starts_with(work.join(folder))),
        "{} is not a model export",
        glb.display()
    );
    let folder = glb.parent().context("the export has no folder")?;
    let target = dest.join(folder.file_name().context("the export folder has no name")?);
    copy_tree(folder, &target)?;
    Ok(target)
}

/// Runs `job` off the async runtime; errors become the message the frontend shows.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Writes the resource at `path` (`<archive>#<offset>`), inflated, to `dest`.
#[tauri::command]
pub async fn save_resource(app: AppHandle, root: PathBuf, path: String, dest: PathBuf) -> Result<(), String> {
    let cache = index::cache_dir(&app)?;
    blocking(move || write_resource(&root, &cache, &path, &dest)).await
}

/// Writes texture `texture` of the resource at `path` to `dest` as a full-size PNG.
#[tauri::command]
pub async fn save_texture(
    app: AppHandle,
    root: PathBuf,
    path: String,
    texture: usize,
    dest: PathBuf,
) -> Result<(), String> {
    let cache = index::cache_dir(&app)?;
    blocking(move || write_texture(&root, &cache, &path, texture, &dest)).await
}

/// Copies a model or vehicle export (the GLB and its textures) into the folder `dest`; returns where it went.
#[tauri::command]
pub async fn save_model(app: AppHandle, glb: PathBuf, dest: PathBuf) -> Result<PathBuf, String> {
    let work = index::work_dir(&app)?;
    blocking(move || copy_model(&work, &glb, &dest)).await
}

#[cfg(test)]
mod tests {
    use openvi_formats::{fixtures, scan_archive};

    use super::*;

    fn game(test: &str) -> (PathBuf, PathBuf, Vec<u64>) {
        let root = std::env::temp_dir().join(format!("openvi-export-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(root.join("common.rpf"), bytes).unwrap();
        let cache = root.join(".work").join("index");
        scan_archive(&root.join("common.rpf"), "common.rpf", &cache, |_, _, _| {}).unwrap();
        (root, cache, offsets)
    }

    #[test]
    fn writes_a_resource_and_a_texture() {
        let (root, cache, offsets) = game("files");
        let archive = root.join("common.rpf").display().to_string();
        let xml = root.join("out.xml");
        let png = root.join("out.png");
        let wrote_xml = write_resource(&root, &cache, &format!("{archive}#{:x}", offsets[2]), &xml);
        let wrote_png = write_texture(&root, &cache, &format!("{archive}#{:x}", offsets[4]), 0, &png);
        let (xml, png) = (std::fs::read(&xml), std::fs::read(&png));
        std::fs::remove_dir_all(&root).unwrap();

        assert!(wrote_xml.is_ok() && wrote_png.is_ok());
        assert!(xml.unwrap().starts_with(b"<?xml"));
        assert!(png.unwrap().starts_with(b"\x89PNG"));
    }

    #[test]
    fn copies_model_exports_only() {
        let (root, _, _) = game("model");
        let work = root.join(".work");
        let export = work.join("models").join("levels").join("car_10");
        std::fs::create_dir_all(export.join("textures")).unwrap();
        std::fs::write(export.join("model.glb"), b"glTF").unwrap();
        std::fs::write(export.join("textures").join("body.png"), b"png").unwrap();
        let dest = root.join("out");
        std::fs::create_dir_all(&dest).unwrap();

        let copied = copy_model(&work, &export.join("model.glb"), &dest);
        let outside = copy_model(&work, &root.join("common.rpf"), &dest);
        let texture = dest.join("car_10").join("textures").join("body.png").is_file();
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(copied.unwrap(), dest.join("car_10"));
        assert!(texture);
        assert!(outside.unwrap_err().to_string().contains("not a model export"));
    }
}
