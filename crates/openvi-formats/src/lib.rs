//! The formats adapter: the only code in OpenVI that calls `sixng-core`.
//!
//! SixNG changes several times an hour, so its types stop here: callers only see the types of this crate.
//! Everything read is unencrypted. An RPF9 archive's table of contents is encrypted and is skipped untouched; its
//! data area is plain zlib, so resources are found by carving those streams and sniffing their first bytes.

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use serde::Serialize;
use sixng_core::{classify, rpf9, scan};

/// The plain part of an RPF9 header.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveHeader {
    /// Where the data area starts: the encrypted table of contents runs from 0x40 to here.
    pub data_start: u64,
    /// Number of entries the header announces (they stay unnamed: the table of contents is encrypted).
    pub entry_count: u32,
    /// Whether the table of contents looks encrypted (high entropy). OpenVI never decrypts it.
    pub toc_encrypted: bool,
}

/// What a carved resource is, sniffed from its first bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    /// RAGE resource with a typed header (models, texture dictionaries, ...).
    Resource,
    /// RAGE object without the typed header.
    RageObject,
    Xml,
    /// RAGE binary XML.
    BinaryXml,
    /// RAGE PSO metadata.
    Pso,
    /// Scaleform movie (UI).
    Scaleform,
    Dds,
    Png,
    Text,
    Binary,
}

impl ResourceKind {
    /// The name the explorer shows for the group.
    pub fn label(self) -> &'static str {
        match self {
            Self::Resource => "RAGE Resource",
            Self::RageObject => "RAGE Object",
            Self::Xml => "XML Document",
            Self::BinaryXml => "Binary XML",
            Self::Pso => "PSO Metadata",
            Self::Scaleform => "Scaleform Movie",
            Self::Dds => "DDS Texture",
            Self::Png => "PNG Image",
            Self::Text => "Text",
            Self::Binary => "Binary Data",
        }
    }
}

impl From<classify::Kind> for ResourceKind {
    fn from(kind: classify::Kind) -> Self {
        use classify::Kind;
        match kind {
            Kind::Resource => Self::Resource,
            Kind::RageObj => Self::RageObject,
            Kind::Xml => Self::Xml,
            Kind::Rbf => Self::BinaryXml,
            Kind::Pso => Self::Pso,
            Kind::Gfx => Self::Scaleform,
            Kind::Dds => Self::Dds,
            Kind::Png => Self::Png,
            Kind::Text => Self::Text,
            Kind::Bin => Self::Binary,
        }
    }
}

/// One resource carved out of an archive's data area.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    /// Offset of its first zlib stream in the archive.
    pub offset: u64,
    /// Bytes on disk, all streams together.
    pub compressed_size: u64,
    /// Bytes once inflated.
    pub size: u64,
    pub kind: ResourceKind,
    /// Resource type id, or the first bytes in hex for unknown data.
    pub sub_type: String,
    /// Suggested extension for an export.
    pub extension: String,
}

/// Everything a scan found in one archive.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveScan {
    /// By offset.
    pub entries: Vec<ArchiveEntry>,
    /// Share of the archive's bytes covered by the carved streams, from 0 to 1.
    pub coverage: f64,
}

/// Reads the header of the RPF9 archive at `path`.
pub fn read_header(path: &Path) -> Result<ArchiveHeader> {
    let header = rpf9::read_header(path)?;
    Ok(ArchiveHeader {
        data_start: (u64::from(header.toc_end) + 15) & !15,
        entry_count: header.count,
        toc_encrypted: header.toc_encrypted,
    })
}

/// Scans the archive at `path` for resources.
///
/// `archive_id` names the archive in the cache (its path from the game folder, with forward slashes). The scan is
/// streamed, runs in parallel segments and is cached in `cache_dir`: an interrupted scan resumes, a finished one is
/// read back until the archive changes. `progress` receives `(bytes done, bytes total)` about twice a second.
pub fn scan_archive(
    path: &Path,
    archive_id: &str,
    cache_dir: &Path,
    progress: impl Fn(u64, u64) + Send + Sync + 'static,
) -> Result<ArchiveScan> {
    let index = scan::build_index(path, archive_id, cache_dir, false, Some(Arc::new(progress)))?;
    let entries = index
        .entries
        .into_iter()
        .map(|entry| ArchiveEntry {
            offset: entry.off,
            compressed_size: entry.csize,
            size: entry.usize,
            kind: entry.kind.into(),
            sub_type: entry.sub,
            extension: entry.ext,
        })
        .collect();
    Ok(ArchiveScan {
        entries,
        coverage: index.stats.coverage,
    })
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::path::PathBuf;

    use flate2::Compression;
    use flate2::write::ZlibEncoder;

    use super::*;

    const TOC_END: usize = 0x140;

    fn zlib(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    /// A synthetic RPF9 archive: header, a noise "table of contents", then three zlib streams with gaps between
    /// them. Returns the archive and the offset of each stream.
    fn synthetic_archive() -> (Vec<u8>, Vec<u64>) {
        let mut bytes = vec![0u8; 0x40];
        bytes[0..4].copy_from_slice(&rpf9::MAGIC.to_le_bytes());
        bytes[4..8].copy_from_slice(&(TOC_END as u32).to_le_bytes());
        bytes[0x24..0x28].copy_from_slice(&3u32.to_le_bytes());

        // Xorshift noise stands in for the encrypted table of contents.
        let mut state = 0x9E37_79B9_u32;
        bytes.extend((0x40..TOC_END).map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state.to_le_bytes()[0]
        }));

        let mut dds = b"DDS ".to_vec();
        dds.resize(512, 0);
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.resize(512, 7);
        let xml = b"<?xml version=\"1.0\"?>\n<vehicles><item>synthetic</item></vehicles>\n".to_vec();

        let mut offsets = Vec::new();
        for payload in [dds, png, xml] {
            offsets.push(bytes.len() as u64);
            bytes.extend(zlib(&payload));
            // Pad to 16 bytes, plus one empty block so streams are not mistaken for pages of the same resource.
            bytes.resize(bytes.len().next_multiple_of(16) + 16, 0);
        }
        (bytes, offsets)
    }

    fn temp_dir(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openvi-formats-{test}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_the_plain_header_and_flags_the_encrypted_toc() {
        let dir = temp_dir("header");
        let archive = dir.join("common.rpf");
        std::fs::write(&archive, synthetic_archive().0).unwrap();
        let result = read_header(&archive);
        std::fs::remove_dir_all(&dir).unwrap();

        let header = result.unwrap();
        assert_eq!(header.data_start, TOC_END as u64);
        assert_eq!(header.entry_count, 3);
        assert!(header.toc_encrypted);
    }

    #[test]
    fn refuses_a_file_that_is_not_rpf9() {
        let dir = temp_dir("not-rpf9");
        let file = dir.join("eboot.bin");
        std::fs::write(&file, [0u8; 0x80]).unwrap();
        let result = read_header(&file);
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(result.is_err());
    }

    #[test]
    fn carves_resources_from_the_data_area_by_kind() {
        let dir = temp_dir("scan");
        let archive = dir.join("common.rpf");
        let (bytes, offsets) = synthetic_archive();
        std::fs::write(&archive, bytes).unwrap();
        let result = scan_archive(&archive, "common.rpf", &dir.join("cache"), |_, _| {});
        std::fs::remove_dir_all(&dir).unwrap();

        let scan = result.unwrap();
        let found: Vec<_> = scan.entries.iter().map(|entry| (entry.offset, entry.kind)).collect();
        assert_eq!(
            found,
            [
                (offsets[0], ResourceKind::Dds),
                (offsets[1], ResourceKind::Png),
                (offsets[2], ResourceKind::Xml),
            ]
        );
        assert_eq!(scan.entries[0].size, 512);
        assert!(scan.coverage > 0.0 && scan.coverage < 1.0);
    }
}
