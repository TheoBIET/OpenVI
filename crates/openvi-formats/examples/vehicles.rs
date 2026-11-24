//! Extracts every vehicle model of the game: id, names, maker, handling and first configuration.
//!
//! `cargo run --release -p openvi-formats --example vehicles -- <game folder> [out folder] [work folder]`
//!
//! Writes `<out>/vehicles.csv` (one line per model) and `<out>/vehicles.json` (the same rows), and prints where
//! SixNG's full records are (every configuration, palette and part group; the full handling records). The work
//! folder holds the scans (default: `openvi-work` in the temp directory, shared with `list_archive`); a second run
//! reuses them. Scanning more archives first (`list_archive` on `levels.rpf`) recovers more model names.

use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use openvi_formats::ScanPhase;
use openvi_formats::catalog::{vehicle_catalog, vehicles_csv};

fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let game = PathBuf::from(
        args.next()
            .context("usage: vehicles <game folder> [out folder] [work folder]")?,
    );
    let out = args.next().map_or_else(|| PathBuf::from("."), PathBuf::from);
    let work = args
        .next()
        .map_or_else(|| std::env::temp_dir().join("openvi-work"), PathBuf::from);

    let started = Instant::now();
    let catalog = vehicle_catalog(&game, &work, |archive, phase, done, total| {
        let step = match phase {
            ScanPhase::Carving => "carving",
            ScanPhase::Naming => "naming ",
        };
        eprint!(
            "\r{archive}: {step} {:>5.1}%   ",
            done as f64 * 100.0 / total.max(1) as f64
        );
        let _ = std::io::stderr().flush();
    })?;
    eprintln!();

    std::fs::create_dir_all(&out)?;
    let csv = out.join("vehicles.csv");
    std::fs::write(&csv, vehicles_csv(&catalog.vehicles))?;
    let json = out.join("vehicles.json");
    std::fs::write(&json, serde_json::to_vec_pretty(&catalog.vehicles)?)?;

    let count =
        |test: fn(&openvi_formats::catalog::Vehicle) -> bool| catalog.vehicles.iter().filter(|v| test(v)).count();
    println!(
        "{} vehicle models in {:.1?}: {} with a model name, {} with a display name, {} with handling values",
        catalog.vehicles.len(),
        started.elapsed(),
        count(|v| v.model.is_some()),
        count(|v| v.display_name.is_some()),
        count(|v| v.mass.is_some()),
    );
    println!("table: {} and {}", csv.display(), json.display());
    println!("full records: {}", catalog.vehicles_json.display());
    if let Some(handling) = &catalog.handling_json {
        println!("full handling: {}", handling.display());
    }
    Ok(())
}
