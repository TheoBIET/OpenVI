//! The formats adapter: the only code in OpenVI that calls `sixng-core`.
//!
//! SixNG changes several times an hour, so its types stop here: callers only see the types of this crate.
//! Everything read is unencrypted. An RPF9 archive's table of contents is encrypted and is skipped untouched; its
//! data area is plain zlib, so resources are found by carving those streams and sniffing their first bytes.

pub mod animations;
pub mod catalog;
pub mod characters;
#[cfg(any(test, feature = "fixtures"))]
pub mod fixtures;
pub mod model;

use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde::Serialize;
use sixng_core::resource::Resource;
use sixng_core::{classify, export, rpf9, scan, texture};

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
    /// The name the resource carries in its own data, when it has one.
    pub name: Option<String>,
    /// RAGE type tag from that name (`dr`, `ft`, `dd`, ...) or `txd` for a texture dictionary.
    pub resource_type: Option<String>,
}

impl ArchiveEntry {
    /// The explorer's "Type" column: the RAGE type when known, else the sniffed kind.
    pub fn type_name(&self) -> &'static str {
        match self.resource_type.as_deref() {
            Some("dr") => "Drawable",
            Some("ft") => "Fragment",
            Some("dd") => "Drawable Dictionary",
            Some("td" | "txd") => "Texture Dictionary",
            _ => self.kind.label(),
        }
    }
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

/// The two passes of a first scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanPhase {
    /// Finding the zlib streams; counted in bytes of the archive.
    Carving,
    /// Reading the names resources carry; counted in resources.
    Naming,
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

/// Scans the archive at `path` for resources and the names they carry.
///
/// `archive_id` names the archive in the cache (its path from the game folder, with forward slashes). The scan is
/// streamed, runs in parallel segments and is cached in `cache_dir`: an interrupted scan resumes, a finished one is
/// read back until the archive changes. `progress` receives `(phase, done, total)` about twice a second.
pub fn scan_archive(
    path: &Path,
    archive_id: &str,
    cache_dir: &Path,
    progress: impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static,
) -> Result<ArchiveScan> {
    let progress = Arc::new(progress);
    let carving = Arc::clone(&progress);
    let mut index = scan::build_index(
        path,
        archive_id,
        cache_dir,
        false,
        Some(Arc::new(move |done, total| carving(ScanPhase::Carving, done, total))),
    )?;
    if !index.names_done {
        let naming = Arc::clone(&progress);
        export::recover_names(
            path,
            &mut index,
            Arc::new(move |_, done, total| naming(ScanPhase::Naming, done, total)),
        )?;
        scan::save_index(cache_dir, &index)?;
    }

    let entries = index.entries.into_iter().map(ArchiveEntry::from).collect();
    Ok(ArchiveScan {
        entries,
        coverage: index.stats.coverage,
    })
}

impl From<scan::Entry> for ArchiveEntry {
    fn from(entry: scan::Entry) -> Self {
        Self {
            offset: entry.off,
            compressed_size: entry.csize,
            size: entry.usize,
            kind: entry.kind.into(),
            sub_type: entry.sub,
            extension: entry.ext,
            name: entry.name,
            resource_type: entry.rtype,
        }
    }
}

/// One texture found in a resource (a texture dictionary, or a model's embedded textures).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureInfo {
    /// Position among the resource's textures: the handle [`texture_png`] takes.
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub mips: u32,
    /// DXGI format name, such as `BC7_UNORM`.
    pub format: String,
}

/// What the properties panel shows for one resource.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDetails {
    #[serde(flatten)]
    pub entry: ArchiveEntry,
    pub type_name: &'static str,
    /// Number of zlib streams the resource spans.
    pub streams: usize,
    pub textures: Vec<TextureInfo>,
}

/// The cached scan entry of the resource at `offset`. The archive must have been scanned with [`scan_archive`].
fn cached_entry(archive_id: &str, cache_dir: &Path, offset: u64) -> Result<scan::Entry> {
    let index = scan::load_index(&scan::index_path(cache_dir, archive_id))
        .with_context(|| format!("{archive_id} has not been scanned yet"))?;
    index
        .entries
        .into_iter()
        .find(|entry| entry.off == offset)
        .with_context(|| format!("no resource at {offset:#x} in {archive_id}"))
}

/// Resources whose pages may hold textures: dictionaries, and models with embedded ones.
fn may_hold_textures(entry: &scan::Entry) -> bool {
    matches!(entry.kind, classify::Kind::Resource | classify::Kind::RageObj)
        && matches!(entry.rtype.as_deref(), Some("txd" | "td" | "dr" | "ft" | "dd"))
}

/// Details of the resource at `offset` in the archive at `path`, including the textures it holds.
pub fn resource_details(path: &Path, archive_id: &str, cache_dir: &Path, offset: u64) -> Result<ResourceDetails> {
    let entry = cached_entry(archive_id, cache_dir, offset)?;
    let textures = if may_hold_textures(&entry) {
        let resource = Resource::load(path, &entry)?;
        texture::find_textures(&resource)
            .into_iter()
            .enumerate()
            .map(|(index, info)| TextureInfo {
                index,
                name: info.name,
                width: info.width,
                height: info.height,
                mips: info.mips,
                format: info.format,
            })
            .collect()
    } else {
        Vec::new()
    };
    let streams = entry.streams.len();
    let entry = ArchiveEntry::from(entry);
    Ok(ResourceDetails {
        type_name: entry.type_name(),
        entry,
        streams,
        textures,
    })
}

/// The start of a text resource, for the text viewer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPreview {
    pub text: String,
    /// The resource is longer than what `text` holds.
    pub truncated: bool,
}

/// The text of the XML or plain-text resource at `offset`, at most `max_bytes` of it.
pub fn resource_text(
    path: &Path,
    archive_id: &str,
    cache_dir: &Path,
    offset: u64,
    max_bytes: usize,
) -> Result<TextPreview> {
    let entry = cached_entry(archive_id, cache_dir, offset)?;
    anyhow::ensure!(
        matches!(entry.kind, classify::Kind::Xml | classify::Kind::Text),
        "the resource at {offset:#x} is not text"
    );
    let bytes = scan::read_entry(path, &entry)?;
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    let truncated = body.len() > max_bytes;
    let mut text = String::from_utf8_lossy(&body[..body.len().min(max_bytes)]).into_owned();
    // A cut in the middle of a UTF-8 sequence decodes to a replacement character at the end.
    if truncated && text.ends_with('\u{FFFD}') {
        text.pop();
    }
    Ok(TextPreview { text, truncated })
}

/// The bytes of the resource at `offset`, inflated (all its streams, in order): what an export writes as is.
pub fn resource_bytes(path: &Path, archive_id: &str, cache_dir: &Path, offset: u64) -> Result<Vec<u8>> {
    let entry = cached_entry(archive_id, cache_dir, offset)?;
    scan::read_entry(path, &entry)
}

/// The bytes of the PNG image resource at `offset`, as stored.
pub fn resource_png(path: &Path, archive_id: &str, cache_dir: &Path, offset: u64) -> Result<Vec<u8>> {
    let entry = cached_entry(archive_id, cache_dir, offset)?;
    anyhow::ensure!(
        entry.kind == classify::Kind::Png,
        "the resource at {offset:#x} is not a PNG image"
    );
    scan::read_entry(path, &entry)
}

/// Texture `index` of the resource at `offset`, decoded to PNG. Uses the largest mip that fits in `max_size` pixels
/// a side, when the texture has one; otherwise the full-size image.
pub fn texture_png(
    path: &Path,
    archive_id: &str,
    cache_dir: &Path,
    offset: u64,
    index: usize,
    max_size: u32,
) -> Result<Vec<u8>> {
    let entry = cached_entry(archive_id, cache_dir, offset)?;
    let resource = Resource::load(path, &entry)?;
    let info = texture::find_textures(&resource)
        .into_iter()
        .nth(index)
        .with_context(|| format!("no texture {index} in the resource at {offset:#x}"))?;

    let mut mip = 0;
    while info.width.max(info.height) >> mip > max_size && mip + 1 < texture::exportable_mips(&info) {
        mip += 1;
    }
    let (format, data, width, height) = if mip == 0 {
        // One-row textures (tint palettes) are stored linear.
        let (format, data) = texture::mip0_linear(&resource, &info, info.height == 1)?;
        (format, data, info.width, info.height)
    } else {
        texture::mip_linear(&resource, &info, mip)?
    };
    let rgba = texture::to_rgba(format, &data, width, height)?;

    let mut png = Vec::new();
    PngEncoder::new(&mut png).write_image(&rgba, width, height, ExtendedColorType::Rgba8)?;
    Ok(png)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;

    fn temp_dir(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openvi-formats-{test}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_the_plain_header_and_flags_the_encrypted_toc() {
        let dir = temp_dir("header");
        let archive = dir.join("common.rpf");
        std::fs::write(&archive, fixtures::archive().0).unwrap();
        let result = read_header(&archive);
        std::fs::remove_dir_all(&dir).unwrap();

        let header = result.unwrap();
        assert_eq!(header.data_start, fixtures::DATA_START);
        assert_eq!(header.entry_count, 4);
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
    fn carves_resources_by_kind_and_recovers_their_names() {
        let dir = temp_dir("scan");
        let archive = dir.join("common.rpf");
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(&archive, bytes).unwrap();
        let phases = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&phases);
        let result = scan_archive(&archive, "common.rpf", &dir.join("cache"), move |phase, _, _| {
            seen.lock().unwrap().push(phase);
        });
        // A second scan is read back from the cache, names included.
        let cached = scan_archive(&archive, "common.rpf", &dir.join("cache"), |_, _, _| {});
        std::fs::remove_dir_all(&dir).unwrap();

        let scan = result.unwrap();
        let found: Vec<_> = scan.entries.iter().map(|entry| (entry.offset, entry.kind)).collect();
        assert_eq!(
            found,
            [
                (offsets[0], ResourceKind::Dds),
                (offsets[1], ResourceKind::Png),
                (offsets[2], ResourceKind::Xml),
                (offsets[3], ResourceKind::RageObject),
                (offsets[4], ResourceKind::RageObject),
            ]
        );
        assert_eq!(scan.entries[0].size, 512);
        assert!(scan.coverage > 0.0 && scan.coverage < 1.0);

        let object = &scan.entries[3];
        assert_eq!(object.name.as_deref(), Some(fixtures::OBJECT_NAME));
        assert_eq!(object.type_name(), "Fragment");
        let dictionary = &scan.entries[4];
        assert_eq!(dictionary.name.as_deref(), Some(fixtures::DICTIONARY_NAME));
        assert_eq!(dictionary.type_name(), "Texture Dictionary");
        assert_eq!(scan.entries[0].type_name(), "DDS Texture");
        assert!(phases.lock().unwrap().contains(&ScanPhase::Naming));

        assert_eq!(cached.unwrap().entries[3].name.as_deref(), Some(fixtures::OBJECT_NAME));
    }

    /// A scanned copy of the synthetic archive; returns its folder (to delete), path and resource offsets.
    fn scanned(test: &str) -> (PathBuf, PathBuf, Vec<u64>) {
        let dir = temp_dir(test);
        let archive = dir.join("common.rpf");
        let (bytes, offsets) = fixtures::archive();
        std::fs::write(&archive, bytes).unwrap();
        scan_archive(&archive, "common.rpf", &dir.join("cache"), |_, _, _| {}).unwrap();
        (dir, archive, offsets)
    }

    #[test]
    fn details_list_the_textures_a_dictionary_holds() {
        let (dir, archive, offsets) = scanned("details");
        let dictionary = resource_details(&archive, "common.rpf", &dir.join("cache"), offsets[4]);
        let xml = resource_details(&archive, "common.rpf", &dir.join("cache"), offsets[2]);
        let missing = resource_details(&archive, "common.rpf", &dir.join("cache"), 0x42);
        std::fs::remove_dir_all(&dir).unwrap();

        let dictionary = dictionary.unwrap();
        assert_eq!(dictionary.type_name, "Texture Dictionary");
        assert_eq!(dictionary.streams, 2);
        let size = u32::from(fixtures::TEXTURE_SIZE);
        assert_eq!(
            dictionary.textures,
            [TextureInfo {
                index: 0,
                name: fixtures::TEXTURE_NAME.into(),
                width: size,
                height: size,
                mips: 1,
                format: "B8G8R8A8_UNORM".into(),
            }]
        );
        assert!(xml.unwrap().textures.is_empty());
        assert!(missing.is_err());
    }

    #[test]
    fn decodes_a_texture_to_png() {
        let (dir, archive, offsets) = scanned("texture");
        let png = texture_png(&archive, "common.rpf", &dir.join("cache"), offsets[4], 0, 1024);
        let absent = texture_png(&archive, "common.rpf", &dir.join("cache"), offsets[4], 1, 1024);
        std::fs::remove_dir_all(&dir).unwrap();

        let image = image::load_from_memory(&png.unwrap()).unwrap().to_rgba8();
        let size = u32::from(fixtures::TEXTURE_SIZE);
        assert_eq!(image.dimensions(), (size, size));
        let [blue, green, red, alpha] = fixtures::TEXTURE_BGRA;
        assert!(image.pixels().all(|pixel| pixel.0 == [red, green, blue, alpha]));
        assert!(absent.is_err());
    }

    #[test]
    fn reads_text_resources_and_refuses_the_others() {
        let (dir, archive, offsets) = scanned("text");
        let full = resource_text(&archive, "common.rpf", &dir.join("cache"), offsets[2], 1 << 20);
        let cut = resource_text(&archive, "common.rpf", &dir.join("cache"), offsets[2], 10);
        let texture = resource_text(&archive, "common.rpf", &dir.join("cache"), offsets[4], 1 << 20);
        std::fs::remove_dir_all(&dir).unwrap();

        let full = full.unwrap();
        assert!(full.text.starts_with("<?xml") && full.text.contains("<vehicles>"));
        assert!(!full.truncated);
        let cut = cut.unwrap();
        assert_eq!((cut.text.as_str(), cut.truncated), ("<?xml vers", true));
        assert!(texture.is_err());
    }

    #[test]
    fn reads_png_resources_as_stored() {
        let (dir, archive, offsets) = scanned("png");
        let png = resource_png(&archive, "common.rpf", &dir.join("cache"), offsets[1]);
        let xml = resource_png(&archive, "common.rpf", &dir.join("cache"), offsets[2]);
        std::fs::remove_dir_all(&dir).unwrap();

        let png = png.unwrap();
        assert!(png.starts_with(b"\x89PNG") && png.len() == 512);
        assert!(xml.is_err());
    }

    #[test]
    fn reads_any_resource_inflated() {
        let (dir, archive, offsets) = scanned("bytes");
        let xml = resource_bytes(&archive, "common.rpf", &dir.join("cache"), offsets[2]);
        let dictionary = resource_bytes(&archive, "common.rpf", &dir.join("cache"), offsets[4]);
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(xml.unwrap().starts_with(b"<?xml"));
        // Both pages of the texture dictionary: the 0x400-byte system page, then the pixels.
        let size = usize::from(fixtures::TEXTURE_SIZE);
        assert_eq!(dictionary.unwrap().len(), 0x400 + size * size * 4);
    }
}
