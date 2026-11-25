//! The Audio section: the sound banks of `audio.rpf`, their streams, and a stream played or saved.

use std::path::PathBuf;

use anyhow::{Result, ensure};
use openvi_formats::audio::{AudioBank, AudioStream, audio_banks, bank_streams, stream_file};
use tauri::AppHandle;
use tauri::ipc::Response;

use crate::index;
use crate::progress::Reporter;

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("{error:#}"))
}

/// Every bank of `audio.rpf` that holds sound; the first call scans the archive (progress in bytes as
/// `catalog-progress`).
#[tauri::command]
pub async fn audio_bank_list(app: AppHandle, root: PathBuf) -> Result<Vec<AudioBank>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    let reporter = Reporter::new(app);
    blocking(move || {
        reporter.step("Opening the audio index…");
        let scanning = reporter.clone();
        audio_banks(&root, &work, move |done, total| {
            scanning.bytes("Scanning audio.rpf: finding the sound banks", done, total);
        })
    })
    .await
}

/// The streams of bank `bank`.
#[tauri::command]
pub async fn audio_stream_list(app: AppHandle, root: PathBuf, bank: String) -> Result<Vec<AudioStream>, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || bank_streams(&root, &work, &bank)).await
}

/// Stream `stream` of bank `bank` as a playable file (Ogg Opus or WAV bytes).
#[tauri::command]
pub async fn audio_stream(app: AppHandle, root: PathBuf, bank: String, stream: String) -> Result<Response, String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || Ok(Response::new(stream_file(&root, &work, &bank, &stream)?.bytes))).await
}

/// Writes stream `stream` of bank `bank` to `dest`, which must end in the stream's own extension (`.ogg`, `.wav`).
#[tauri::command]
pub async fn save_audio(
    app: AppHandle,
    root: PathBuf,
    bank: String,
    stream: String,
    dest: PathBuf,
) -> Result<(), String> {
    let root = index::canonical_root(&root)?;
    let work = index::work_dir(&app)?;
    blocking(move || {
        let file = stream_file(&root, &work, &bank, &stream)?;
        ensure!(
            dest.extension().is_some_and(|extension| extension == file.extension),
            "this stream saves as .{}",
            file.extension
        );
        std::fs::write(&dest, file.bytes)?;
        Ok(())
    })
    .await
}
