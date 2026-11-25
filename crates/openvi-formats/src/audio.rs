//! Audio: the sound banks of `audio.rpf` (`ADAT` containers: music, speech, effects), their streams, and one stream
//! as a playable file.
//!
//! `audio.rpf` has no RPF index of its own sounds: SixNG finds the banks by scanning it (about two and a half
//! minutes, index about 30 MB in `<work>/index`, kept until the archive changes). Opus streams (nearly all) become
//! Ogg Opus without decoding; PCM ones WAV. A multichannel music stream holds several stems: its first one is played.
//! Names appear where SixNG recovered them (`audio-meta`, `names`); the rest go by offset and hash.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sixng_core::audio::{self, AudioIndex};

/// The archive holding the sound banks.
pub const AUDIO_ARCHIVE: &str = "audio.rpf";

/// One sound bank.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioBank {
    /// Offset in `audio.rpf`, hex: the id.
    pub id: String,
    /// Its name, where recovered.
    pub name: Option<String>,
    pub size: u64,
    /// Streams that hold sound, and their length together.
    pub streams: usize,
    pub seconds: f64,
}

/// One stream of a bank.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    /// Hash id, 8 hex digits.
    pub id: String,
    pub name: Option<String>,
    pub seconds: f64,
    pub channels: u32,
    /// `blocks` (Opus), `music` (stems), `pcm16`, `pcmf32`, `xma2`, `other`.
    pub layout: String,
    /// Whether [`stream_file`] can make a file of it.
    pub playable: bool,
}

/// A stream as a file: its bytes and its extension (`ogg` or `wav`).
pub struct StreamFile {
    pub bytes: Vec<u8>,
    pub extension: &'static str,
}

type Loaded = (u64, Arc<AudioIndex>);

/// The audio index, scanned on first use and kept in memory (it is large) until the archive changes.
fn audio_index(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(u64, u64) + Send + Sync + 'static,
) -> Result<Arc<AudioIndex>> {
    static MEMORY: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
    let path = game_root.join(AUDIO_ARCHIVE);
    ensure!(path.is_file(), "{} has no {AUDIO_ARCHIVE}", game_root.display());
    let size = std::fs::metadata(&path)?.len();
    let memory = MEMORY.get_or_init(Default::default);
    if let Some((known, index)) = memory.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref()
        && *known == size
    {
        return Ok(Arc::clone(index));
    }
    let index = match audio::load_index(work_dir, AUDIO_ARCHIVE) {
        Ok(index) if index.archive_size == size => index,
        _ => {
            let index = audio::scan(
                &path,
                AUDIO_ARCHIVE,
                Arc::new(move |_, done, total| progress(done, total)),
            )?;
            audio::save_index(work_dir, &index)?;
            index
        }
    };
    let index = Arc::new(index);
    *memory.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((size, Arc::clone(&index)));
    Ok(index)
}

/// Bank names (by offset) and stream names (by bank offset, then id), where SixNG recovered them.
fn names(work_dir: &Path) -> (BTreeMap<u64, String>, BTreeMap<u64, BTreeMap<u32, String>>) {
    let banks = sixng_core::audiometa::load_containers(work_dir, AUDIO_ARCHIVE)
        .map(|containers| sixng_core::audiometa::bank_container(&containers))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(bank, hash)| Some((bank, sixng_core::names::lookup(hash, sixng_core::names::Ctx::Audio)?)))
        .collect();
    (banks, sixng_core::names::load_stream_names(work_dir, AUDIO_ARCHIVE))
}

/// Every bank that holds sound, named ones first. Scans `audio.rpf` the first time (`progress` in bytes).
pub fn audio_banks(
    game_root: &Path,
    work_dir: &Path,
    progress: impl Fn(u64, u64) + Send + Sync + 'static,
) -> Result<Vec<AudioBank>> {
    let index = audio_index(game_root, work_dir, progress)?;
    let (bank_names, _) = names(work_dir);
    let mut banks: Vec<AudioBank> = index
        .banks
        .iter()
        .filter(|bank| bank.streams.iter().any(|stream| stream.layout != "none"))
        .map(|bank| AudioBank {
            id: format!("{:x}", bank.off),
            name: bank_names.get(&bank.off).cloned(),
            size: bank.size,
            streams: bank.streams.iter().filter(|stream| stream.layout != "none").count(),
            seconds: bank.seconds(),
        })
        .collect();
    banks.sort_by(|a, b| (a.name.is_none(), &a.name).cmp(&(b.name.is_none(), &b.name)));
    Ok(banks)
}

fn bank_of<'a>(index: &'a AudioIndex, bank: &str) -> Result<&'a audio::Bank> {
    let offset = u64::from_str_radix(bank, 16).with_context(|| format!("bad bank id {bank}"))?;
    index
        .banks
        .iter()
        .find(|candidate| candidate.off == offset)
        .with_context(|| format!("no bank at {bank} in {AUDIO_ARCHIVE}"))
}

/// The streams of bank `bank` (its id from [`audio_banks`]) that hold sound.
pub fn bank_streams(game_root: &Path, work_dir: &Path, bank: &str) -> Result<Vec<AudioStream>> {
    let index = audio_index(game_root, work_dir, |_, _| {})?;
    let found = bank_of(&index, bank)?;
    let (_, stream_names) = names(work_dir);
    let named = stream_names.get(&found.off);
    Ok(found
        .streams
        .iter()
        .filter(|stream| stream.layout != "none")
        .map(|stream| AudioStream {
            id: format!("{:08x}", stream.id),
            name: named.and_then(|names| names.get(&stream.id)).cloned(),
            seconds: stream.seconds(),
            channels: stream.channels,
            layout: stream.layout.clone(),
            playable: matches!(stream.layout.as_str(), "blocks" | "music" | "pcm16" | "pcmf32"),
        })
        .collect())
}

/// Stream `stream` of bank `bank` as a file: Ogg Opus (Opus, and a music stream's first stem) or WAV (PCM).
pub fn stream_file(game_root: &Path, work_dir: &Path, bank: &str, stream: &str) -> Result<StreamFile> {
    let index = audio_index(game_root, work_dir, |_, _| {})?;
    let found = bank_of(&index, bank)?;
    let id = u32::from_str_radix(stream, 16).with_context(|| format!("bad stream id {stream}"))?;
    let wanted = found
        .streams
        .iter()
        .find(|candidate| candidate.id == id)
        .with_context(|| format!("no stream {stream} in bank {bank}"))?;
    let bytes = audio::read_bank(&game_root.join(AUDIO_ARCHIVE), found)?;
    let tag = audio::stem(found, wanted);
    match wanted.layout.as_str() {
        "blocks" => {
            let packets = audio::packets(&bytes, wanted);
            ensure!(!packets.is_empty(), "stream {stream} has no Opus packets");
            Ok(StreamFile {
                bytes: audio::ogg_opus(&packets, wanted.frames(), &tag),
                extension: "ogg",
            })
        }
        "music" => {
            let stem = audio::music_channels(&bytes, found.off, wanted)?
                .into_iter()
                .find(|channel| !channel.packets.is_empty())
                .with_context(|| format!("music stream {stream} has no stem with sound"))?;
            Ok(StreamFile {
                bytes: audio::ogg_opus(&stem.packets, stem.frames, &tag),
                extension: "ogg",
            })
        }
        "pcm16" | "pcmf32" => Ok(StreamFile {
            bytes: audio::pcm_wav(audio::stream_data(&bytes, wanted)?, wanted)?,
            extension: "wav",
        }),
        layout => bail!("stream {stream}: {layout} streams cannot be played"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_audio_archive() {
        let root = std::env::temp_dir().join(format!("openvi-audio-none-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let banks = audio_banks(&root, &root.join("work"), |_, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(banks.unwrap_err().to_string().contains(AUDIO_ARCHIVE));
    }

    #[test]
    fn finds_no_banks_in_an_archive_without_sound() {
        let root = std::env::temp_dir().join(format!("openvi-audio-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(AUDIO_ARCHIVE), crate::fixtures::archive().0).unwrap();
        let banks = audio_banks(&root, &root.join("work"), |_, _| {});
        std::fs::remove_dir_all(&root).unwrap();
        assert!(banks.unwrap().is_empty());
    }
}
