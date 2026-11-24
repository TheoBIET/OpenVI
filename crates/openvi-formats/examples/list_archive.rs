//! Lists the resources of one RPF9 archive by type, with how many carry a name.
//!
//! `cargo run --release -p openvi-formats --example list_archive -- <archive.rpf> [cache folder]`
//!
//! The cache defaults to a folder in the system temp directory; a second run reads it back.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use openvi_formats::{ScanPhase, read_header, scan_archive};

fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let archive = PathBuf::from(
        args.next()
            .context("usage: list_archive <archive.rpf> [cache folder]")?,
    );
    let cache = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("openvi-cache"));
    let id = archive
        .file_name()
        .context("the archive path has no file name")?
        .to_string_lossy()
        .into_owned();

    let header = read_header(&archive)?;
    println!(
        "{id}: data from {:#x}, {} entries announced, table of contents {}",
        header.data_start,
        header.entry_count,
        if header.toc_encrypted {
            "encrypted (skipped)"
        } else {
            "plain"
        }
    );

    let started = Instant::now();
    let scan = scan_archive(&archive, &id, &cache, |phase, done, total| {
        let step = match phase {
            ScanPhase::Carving => "carving",
            ScanPhase::Naming => "naming ",
        };
        eprint!("\r{step} {:>5.1}%", done as f64 * 100.0 / total.max(1) as f64);
        let _ = std::io::stderr().flush();
    })?;
    eprintln!();

    let mut by_type = BTreeMap::new();
    for entry in &scan.entries {
        let (count, named, bytes) = by_type.entry(entry.type_name()).or_insert((0u64, 0u64, 0u64));
        *count += 1;
        *named += u64::from(entry.name.is_some());
        *bytes += entry.size;
    }
    println!(
        "{} resources in {:.1?}, {:.1}% of the archive covered",
        scan.entries.len(),
        started.elapsed(),
        scan.coverage * 100.0
    );
    println!("  {:<20} {:>8} {:>8} {:>12}", "type", "count", "named", "inflated");
    for (type_name, (count, named, bytes)) in by_type {
        println!(
            "  {type_name:<20} {count:>8} {named:>8} {:>8.1} MiB",
            bytes as f64 / (1 << 20) as f64
        );
    }
    Ok(())
}
