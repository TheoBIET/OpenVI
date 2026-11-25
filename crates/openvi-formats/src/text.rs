//! Game text: the localised strings of `data.rpf` (UI, item names, subtitles, phone and ambient speech), searchable.
//!
//! The text tables (`sixng_core::text`) hold every string once per language, with no language tag. The English
//! tables are told apart by their words (`the`, `you`, `and`), and only their strings are searched: about one string
//! in fourteen. They are read once (about twenty seconds), kept in `<work>/index/text.<data.rpf state>.json` and in
//! memory.

use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sixng_core::export::Workspace;

use crate::model::version;
use crate::{ScanPhase, scan_archive};

/// The archive holding the text tables.
pub const TEXT_ARCHIVE: &str = "data.rpf";

/// One string of the game.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLine {
    /// Hash of its label (joaat of the lower-case label), 8 hex digits.
    pub label: String,
    /// The string without its markup (`~n~`, `~sl:…~` timings, button codes).
    pub text: String,
    /// The string as stored, markup included.
    pub raw: String,
    /// The table holding it (`data.rpf@<offset>`).
    pub table: String,
}

/// The lines matching a search, best first, and how many matched in all.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSearch {
    pub total: usize,
    pub lines: Vec<TextLine>,
    /// English strings searched.
    pub searched: usize,
}

/// Whether a table reads like English: a fair share of its sentences use the commonest English words.
fn is_english(strings: &[String]) -> bool {
    let sentences: Vec<String> = strings
        .iter()
        .filter(|text| text.split_whitespace().count() >= 3)
        .map(|text| format!(" {} ", text.to_lowercase()))
        .collect();
    if sentences.len() < 4 {
        return false;
    }
    let english = sentences
        .iter()
        .filter(|text| {
            [" the ", " you ", " and ", " to "]
                .iter()
                .any(|word| text.contains(word))
        })
        .count();
    english * 4 >= sentences.len()
}

/// Reads the English strings of the text tables (every table when none reads like English).
fn read_lines(game_root: &Path, work_dir: &Path) -> Result<Vec<TextLine>> {
    let workspace = Workspace::new(game_root, work_dir);
    let archive = workspace.resolve(TEXT_ARCHIVE)?;
    let index = crate::index_cache::load(&workspace.index_dir(), TEXT_ARCHIVE)?;
    let (tables, _) = sixng_core::text::read_all(&archive, &index.entries, &[], Arc::new(|_, _, _| {}))?;
    let english: Vec<bool> = tables
        .iter()
        .map(|table| is_english(&table.strings.values().take(400).cloned().collect::<Vec<_>>()))
        .collect();
    let any = english.iter().any(|keep| *keep);
    let mut lines = Vec::new();
    for (table, keep) in tables.iter().zip(english) {
        if any && !keep {
            continue;
        }
        for (label, raw) in &table.strings {
            let text = sixng_core::text::plain(raw);
            if text.is_empty() {
                continue;
            }
            lines.push(TextLine {
                label: format!("{label:08x}"),
                text,
                raw: raw.clone(),
                table: table.id.clone(),
            });
        }
    }
    // One copy of a string repeated in several tables.
    lines.sort_by(|a, b| (&a.label, &a.text).cmp(&(&b.label, &b.text)));
    lines.dedup_by(|a, b| a.label == b.label && a.text == b.text);
    Ok(lines)
}

/// The text read for one state of `data.rpf`.
type Loaded = (String, Arc<Vec<TextLine>>);

/// The English strings of the game, read once per state of `data.rpf` (scanned first if needed).
pub fn text_lines(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<Arc<Vec<TextLine>>> {
    static MEMORY: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    let path = game_root.join(TEXT_ARCHIVE);
    anyhow::ensure!(path.is_file(), "{} has no {TEXT_ARCHIVE}", game_root.display());
    let workspace = Workspace::new(game_root, work_dir);
    scan_archive(&path, TEXT_ARCHIVE, &workspace.index_dir(), progress)?;
    let state = version(&path);
    let memory = MEMORY.get_or_init(Default::default);
    if let Some((known, lines)) = memory.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref()
        && *known == state
    {
        return Ok(Arc::clone(lines));
    }
    let cache = workspace.index_dir().join(format!("text.{state}.json"));
    let lines = match std::fs::read(&cache)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(lines) => lines,
        None => {
            let lines = read_lines(game_root, work_dir)?;
            // Only the current state's cache is kept.
            if let Ok(entries) = std::fs::read_dir(workspace.index_dir()) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("text.") && name.ends_with(".json") {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
            std::fs::write(&cache, serde_json::to_vec(&lines)?)?;
            lines
        }
    };
    let lines = Arc::new(lines);
    *memory.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((state, Arc::clone(&lines)));
    Ok(lines)
}

/// The lines whose text contains `query` (any case) or whose label hash is `query`: whole-word matches first, then
/// shorter lines; at most `limit`.
pub fn search(lines: &[TextLine], query: &str, limit: usize) -> TextSearch {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return TextSearch {
            total: 0,
            lines: Vec::new(),
            searched: lines.len(),
        };
    }
    let label = needle.trim_start_matches("0x");
    let mut hits: Vec<(u8, usize, &TextLine)> = lines
        .iter()
        .filter_map(|line| {
            if line.label == label {
                return Some((0, 0, line));
            }
            let lower = line.text.to_lowercase();
            let at = lower.find(&needle)?;
            let before = lower[..at].chars().next_back().is_none_or(|c| !c.is_alphanumeric());
            let after = lower[at + needle.len()..]
                .chars()
                .next()
                .is_none_or(|c| !c.is_alphanumeric());
            Some((if before && after { 1 } else { 2 }, line.text.len(), line))
        })
        .collect();
    let total = hits.len();
    hits.sort_by_key(|(rank, length, _)| (*rank, *length));
    TextSearch {
        total,
        lines: hits.into_iter().take(limit).map(|(_, _, line)| line.clone()).collect(),
        searched: lines.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(label: &str, text: &str) -> TextLine {
        TextLine {
            label: label.into(),
            text: text.into(),
            raw: text.into(),
            table: "data.rpf@0".into(),
        }
    }

    #[test]
    fn tells_english_tables_apart() {
        let english: Vec<String> = [
            "Get in the car",
            "You are late",
            "Meet me at the docks",
            "Bring the money and run",
        ]
        .map(String::from)
        .to_vec();
        let german: Vec<String> = [
            "Steig in das Auto",
            "Du bist spät",
            "Triff mich am Hafen",
            "Bring das Geld und lauf",
        ]
        .map(String::from)
        .to_vec();
        assert!(is_english(&english));
        assert!(!is_english(&german));
    }

    #[test]
    fn finds_whole_words_first_then_labels() {
        let lines = vec![
            line("00000001", "Carpet cleaning"),
            line("00000002", "Get in the car"),
            line("0badc0de", "Nothing here"),
        ];
        let found = search(&lines, "car", 10);
        assert_eq!(found.total, 2);
        assert_eq!(found.lines[0].label, "00000002");
        assert_eq!(search(&lines, "0x0badc0de", 10).lines[0].text, "Nothing here");
        assert_eq!(search(&lines, "  ", 10).total, 0);
    }

    #[test]
    fn needs_the_text_archive() {
        let root = std::env::temp_dir().join(format!("openvi-text-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let lines = text_lines(&root, &root.join("work"), |_, _, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(lines.unwrap_err().to_string().contains(TEXT_ARCHIVE));
    }
}
