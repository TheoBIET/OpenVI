# Third-party notices

OpenVI is licensed under the GNU General Public License v3.0 only (see `LICENSE`). It links the libraries below.

## SixNG (`sixng-core`)

Format decoders for GTA VI files, linked by `crates/openvi-formats` (the only caller). <https://github.com/holdmysocks/SixNG>,
pinned to commit `13de59331918ec0d426fca685a1fbbf434c5a6f5`, built without its `opus-decode` feature. Licensed
under the GNU General Public License v3.0 only. Its own notices (AMD addrlib, MIT) are in its
`THIRD_PARTY_NOTICES.md`.

## bcpack-rs

Texture block decompression, a dependency of `sixng-core`. <https://github.com/Ahmet-Dedeler/bcpack-rs>, commit
`02a8c4e802800d55b55797a32dbfe8b16d7fc23f`. Licensed under `MIT OR Apache-2.0`; its notices (Microsoft
silicon-rans, MIT) are in its `THIRD_PARTY_NOTICES.md`.

## Other crates

The remaining Rust and npm dependencies are listed in `Cargo.lock` and `pnpm-lock.yaml`, each with its own licence.
