//! Synthetic RPF9 archives for tests. Every byte is written here; nothing comes from the game.

use std::io::Write;

use flate2::Compression;
use flate2::write::ZlibEncoder;

/// Where the data area of [`archive`] starts.
pub const DATA_START: u64 = 0x140;

/// The name carried by the RAGE object of [`archive`].
pub const OBJECT_NAME: &str = "synthetic_car";

/// The name of the texture dictionary of [`archive`].
pub const DICTIONARY_NAME: &str = "synthetic_textures";

/// The one texture of that dictionary: square, one mip, B8G8R8A8, every pixel [`TEXTURE_BGRA`].
pub const TEXTURE_NAME: &str = "synthetic_diffuse";
pub const TEXTURE_SIZE: u16 = 64;
pub const TEXTURE_BGRA: [u8; 4] = [0x10, 0x80, 0xF0, 0xFF];

fn zlib(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).expect("writing to a Vec cannot fail");
    encoder.finish().expect("writing to a Vec cannot fail")
}

fn put(page: &mut [u8], at: usize, bytes: &[u8]) {
    page[at..at + bytes.len()].copy_from_slice(bytes);
}

/// A RAGE object system page: a page-map pointer at +0x08 and a "<name>.#ft" string, as fragments carry.
fn rage_object() -> Vec<u8> {
    let mut page = vec![0u8; 0x400];
    put(&mut page, 8, &0x5000_0100_u64.to_le_bytes());
    put(&mut page, 0x200, format!("{OBJECT_NAME}.#ft").as_bytes());
    page
}

/// A texture dictionary: its system page (dictionary header, name after the page map, one texture struct) and its
/// graphics page (the pixels).
fn texture_dictionary() -> (Vec<u8>, Vec<u8>) {
    let mut sys = vec![0u8; 0x400];
    // Page map at 0x100; the dictionary name follows it.
    put(&mut sys, 8, &0x5000_0100_u64.to_le_bytes());
    put(&mut sys, 0x110, DICTIONARY_NAME.as_bytes());
    // Dictionary header: key and texture arrays (system pointers) with one item each.
    put(&mut sys, 0x20, &0x5000_0380_u64.to_le_bytes());
    put(&mut sys, 0x28, &[1, 0, 1, 0]);
    put(&mut sys, 0x30, &0x5000_0390_u64.to_le_bytes());
    put(&mut sys, 0x38, &[1, 0, 1, 0]);
    // Texture struct at 0x200.
    let texture = 0x200;
    put(&mut sys, texture + 0x0E, &8u16.to_le_bytes());
    put(&mut sys, texture + 0x18, &0x6000_0000_u64.to_le_bytes());
    put(&mut sys, texture + 0x30, &0x5000_0300_u64.to_le_bytes());
    put(&mut sys, texture + 0x38, &TEXTURE_SIZE.to_le_bytes());
    put(&mut sys, texture + 0x3A, &TEXTURE_SIZE.to_le_bytes());
    put(&mut sys, texture + 0x3C, &1u16.to_le_bytes());
    sys[texture + 0x3F] = 87; // DXGI_FORMAT_B8G8R8A8_UNORM
    sys[texture + 0x42] = 1; // mips
    put(&mut sys, 0x308, TEXTURE_NAME.as_bytes());

    let pixels = usize::from(TEXTURE_SIZE) * usize::from(TEXTURE_SIZE);
    (sys, TEXTURE_BGRA.repeat(pixels))
}

/// An RPF9 archive: header, a noise "table of contents", then five resources (DDS, PNG, XML, a named RAGE object, a
/// texture dictionary of two pages) with a gap after each. Returns the bytes and the offset of each resource.
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
    let (dictionary, pixels) = texture_dictionary();

    let mut offsets = Vec::new();
    for pages in [
        vec![dds],
        vec![png],
        vec![xml],
        vec![rage_object()],
        vec![dictionary, pixels],
    ] {
        offsets.push(bytes.len() as u64);
        for page in pages {
            // Pages of one resource follow each other, 16-byte aligned.
            bytes.extend(zlib(&page));
            bytes.resize(bytes.len().next_multiple_of(16), 0);
        }
        // One empty block after each resource, so the next one is not mistaken for another page of it.
        bytes.resize(bytes.len() + 16, 0);
    }
    (bytes, offsets)
}
