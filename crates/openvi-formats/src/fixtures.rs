//! Synthetic RPF9 archives for tests. Every byte is written here; nothing comes from the game.

use std::io::Write;

use flate2::Compression;
use flate2::write::ZlibEncoder;

/// Where the data area of [`archive`] starts.
pub const DATA_START: u64 = 0x140;

/// The name carried by the RAGE object of [`archive`].
pub const OBJECT_NAME: &str = "synthetic_car";

fn zlib(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).expect("writing to a Vec cannot fail");
    encoder.finish().expect("writing to a Vec cannot fail")
}

/// A RAGE object system page: a page-map pointer at +0x08 and a "<name>.#ft" string, as fragments carry.
fn rage_object() -> Vec<u8> {
    let mut page = vec![0u8; 0x400];
    page[8..16].copy_from_slice(&0x5000_0100_u64.to_le_bytes());
    let name = format!("{OBJECT_NAME}.#ft");
    page[0x200..0x200 + name.len()].copy_from_slice(name.as_bytes());
    page
}

/// An RPF9 archive: header, a noise "table of contents", then four zlib streams (DDS, PNG, XML, a named RAGE object)
/// with a gap after each. Returns the bytes and the offset of each stream.
pub fn archive() -> (Vec<u8>, Vec<u64>) {
    let mut bytes = vec![0u8; 0x40];
    bytes[0..4].copy_from_slice(&0x5250_4639_u32.to_le_bytes());
    bytes[4..8].copy_from_slice(&(DATA_START as u32).to_le_bytes());
    bytes[0x24..0x28].copy_from_slice(&4u32.to_le_bytes());

    // Xorshift noise stands in for the encrypted table of contents.
    let mut state = 0x9E37_79B9_u32;
    bytes.extend((0x40..DATA_START).map(|_| {
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
    for payload in [dds, png, xml, rage_object()] {
        offsets.push(bytes.len() as u64);
        bytes.extend(zlib(&payload));
        // Pad to 16 bytes, plus one empty block so streams are not mistaken for pages of the same resource.
        bytes.resize(bytes.len().next_multiple_of(16) + 16, 0);
    }
    (bytes, offsets)
}
