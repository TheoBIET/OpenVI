//! Loose files of the game folder (outside archives): text and images for the document view.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{Result, ensure};
use serde::Serialize;
use tauri::ipc::Response;

use crate::fs::{Located, locate};

/// Most bytes of a text file the document view shows.
pub const TEXT_LIMIT: usize = 8 << 20;

/// Largest image the document view loads.
const IMAGE_LIMIT: u64 = 64 << 20;

/// Bytes sniffed to tell text from binary.
const SNIFF: usize = 8192;

/// What the document view can show of a file.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilePreview {
    #[serde(rename_all = "camelCase")]
    Text {
        text: String,
        truncated: bool,
    },
    /// Fetch the bytes with [`file_bytes`].
    Image {
        mime: &'static str,
    },
    Binary,
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => return None,
    })
}

/// Text: no NUL byte, and valid UTF-8 apart from a sequence cut at the end of the sample.
fn looks_like_text(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return false;
    }
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(error) => error.error_len().is_none(),
    }
}

/// Decodes `bytes` (UTF-8, BOM dropped) to at most `limit` bytes of text.
pub(crate) fn decode_text(bytes: &[u8], limit: usize) -> (String, bool) {
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let truncated = body.len() > limit;
    let mut text = String::from_utf8_lossy(&body[..body.len().min(limit)]).into_owned();
    // A cut in the middle of a UTF-8 sequence decodes to a replacement character at the end.
    if truncated && text.ends_with('\u{FFFD}') {
        text.pop();
    }
    (text, truncated)
}

fn confined_file(root: &Path, path: &Path) -> Result<PathBuf> {
    let Located { path, .. } = locate(root, path)?;
    ensure!(path.is_file(), "{} is not a file", path.display());
    Ok(path)
}

fn preview(root: &Path, path: &Path) -> Result<FilePreview> {
    let path = confined_file(root, path)?;
    if let Some(mime) = image_mime(&path) {
        return Ok(FilePreview::Image { mime });
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)?
        .take(TEXT_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)?;
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    if !looks_like_text(&body[..body.len().min(SNIFF)]) {
        return Ok(FilePreview::Binary);
    }
    let (text, truncated) = decode_text(&bytes, TEXT_LIMIT);
    Ok(FilePreview::Text { text, truncated })
}

fn bytes(root: &Path, path: &Path) -> Result<Vec<u8>> {
    let path = confined_file(root, path)?;
    let size = std::fs::metadata(&path)?.len();
    ensure!(size <= IMAGE_LIMIT, "{} is too large to preview", path.display());
    Ok(std::fs::read(path)?)
}

/// How the document view shows the file at `path`, which must be inside `root`; the text, for a text file.
#[tauri::command]
pub async fn file_preview(root: PathBuf, path: PathBuf) -> Result<FilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview(&root, &path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// The raw bytes of the image file at `path`, which must be inside `root`.
#[tauri::command]
pub async fn file_bytes(root: PathBuf, path: PathBuf) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || bytes(&root, &path))
        .await
        .map_err(|error| error.to_string())?
        .map(Response::new)
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game_folder(test: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("openvi-file-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("x64")).unwrap();
        std::fs::write(
            root.join("settings.xml"),
            "\u{FEFF}<settings>\n  <item value=\"été\" />\n</settings>\n",
        )
        .unwrap();
        std::fs::write(root.join("icon.png"), b"\x89PNG\r\n\x1a\nsynthetic").unwrap();
        std::fs::write(root.join("eboot.bin"), [0x7f, b'E', b'L', b'F', 0, 1, 2]).unwrap();
        dunce::canonicalize(root).unwrap()
    }

    #[test]
    fn tells_text_images_and_binaries_apart() {
        let root = game_folder("kinds");
        let xml = preview(&root, &root.join("settings.xml"));
        let png = preview(&root, &root.join("icon.png"));
        let png_bytes = bytes(&root, &root.join("icon.png"));
        let binary = preview(&root, &root.join("eboot.bin"));
        let folder = preview(&root, &root.join("x64"));
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(
            xml.unwrap(),
            FilePreview::Text {
                text: "<settings>\n  <item value=\"été\" />\n</settings>\n".into(),
                truncated: false
            }
        );
        assert_eq!(png.unwrap(), FilePreview::Image { mime: "image/png" });
        assert!(png_bytes.unwrap().starts_with(b"\x89PNG"));
        assert_eq!(binary.unwrap(), FilePreview::Binary);
        assert!(folder.is_err());
    }

    #[test]
    fn refuses_files_outside_the_game_folder() {
        let root = game_folder("outside");
        let result = preview(&root.join("x64"), &root.join("settings.xml"));
        let raw = bytes(&root.join("x64"), &root.join("icon.png"));
        std::fs::remove_dir_all(&root).unwrap();

        assert!(result.is_err() && raw.is_err());
    }

    #[test]
    fn cuts_long_text_on_a_character_boundary() {
        let (text, truncated) = decode_text("aé".as_bytes(), 2);
        assert_eq!((text.as_str(), truncated), ("a", true));
    }
}
