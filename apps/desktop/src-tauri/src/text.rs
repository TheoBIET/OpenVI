//! The Text section: the game's English strings, searched.

use std::path::PathBuf;

use openvi_formats::text::{TEXT_ARCHIVE, TextSearch, search, text_lines};
use tauri::AppHandle;

use crate::catalog::scan_all;
use crate::index;
use crate::progress::Reporter;

/// Most lines a search returns: the count says how many matched in all.
const SHOWN: usize = 500;

/// The game's strings matching `query` (any case, or a label hash); the first call reads the text tables (scanning
/// `data.rpf` first when needed, each step as `catalog-progress`).
#[tauri::command]
pub async fn game_text(app: AppHandle, root: PathBuf, query: String) -> Result<TextSearch, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let database = index::database(&app, &root)?;
    let reporter = Reporter::new(app);
    tauri::async_runtime::spawn_blocking(move || {
        scan_all(&root, &work, &database, &[TEXT_ARCHIVE], &reporter)?;
        reporter.step("Reading the game text (the first time takes about half a minute)…");
        let lines = text_lines(&root, &work, |_, _, _| {})?;
        Ok(search(&lines, &query, SHOWN))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error: anyhow::Error| format!("{error:#}"))
}
