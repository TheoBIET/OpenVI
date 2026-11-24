<div align="center">
  <img src="apps/desktop/app-icon.svg" width="96" alt="OpenVI" />
  <h1>OpenVI</h1>
  <p><strong>An unofficial, open-source explorer and data-mining toolkit for GTA VI files, in the spirit of OpenIV.</strong></p>
  <p>Browse the folders and RPF9 archives of your own install, look inside them, and catalog what the game holds.</p>

[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-ff4f9a)](LICENSE)
[![Status: early development](https://img.shields.io/badge/status-early%20development-ff8a4c)](#roadmap)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-2fd5c8)](https://v2.tauri.app)
[![Built by AI](https://img.shields.io/badge/built%20by-AI%20agents-9b92b0)](#built-by-ai)

</div>

> [!WARNING]
> OpenVI is in early development: there is no release to download yet. It reads files you own and never decrypts,
> uploads or modifies them. Read [the legal notes](docs/LEGAL.md) before contributing.

## What it is

OpenVI is a desktop file explorer for a GTA VI install, in the tradition of OpenIV for the earlier games:
a folder tree on the left, a detailed list grouped by type on the right, and a path bar and filter on top. On top of
the explorer it builds a searchable index of the archives' contents, so you can find vehicles, weapons, missions and
assets the game never shows.

It runs on Windows, macOS and Linux.

## Roadmap

| Feature                                                                       | Status     |
| ----------------------------------------------------------------------------- | ---------- |
| Explorer: folder tree, grouped details list, path bar, filter, history        | ✅ done    |
| Archive view: resources inside RPF9 archives, by type, with recovered names   | ✅ done    |
| Viewers: textures and text done; 3D models, audio, exports to come            | 🚧 started |
| Search across the whole index: names (hashes and game text to come)           | ✅ names   |
| Data-mining views: vehicles, weapons, missions, unreferenced (hidden) content | 🗓️ planned |
| Map viewer in the spirit of CodeWalker                                        | 💭 later   |
| Modding (replacing files) through a PC compatibility layer's overlay          | 💭 later   |

> [!NOTE]
> The table of contents of RPF9 archives is encrypted, and OpenVI does not decrypt it. Inside an archive you will
> see resources grouped by type, named where the name can be recovered from the data itself, not the original folder
> tree. See [ARCHITECTURE.md](docs/ARCHITECTURE.md#what-the-encrypted-table-of-contents-means).

## How it works

```mermaid
flowchart LR
  install["Your GTA VI install<br/>(folders, RPF9 archives)"] --> backend["Rust backend<br/>(Tauri commands)"]
  backend --> decoders["sixng-core<br/>(format decoders)"]
  decoders --> index[("Local index<br/>SQLite + full-text search")]
  backend --> ui["React UI<br/>explorer, viewers, search"]
  index --> ui
  ui -->|export| out["glTF · PNG · JSON · CSV<br/>on your machine only"]
```

## Built by AI

OpenVI is developed entirely by AI agents ([Claude Code](https://claude.com/claude-code)): code, documentation and
design. The maintainer decides what gets built and tests it on real hardware. Human and agent contributions follow the
same rules ([CONTRIBUTING.md](CONTRIBUTING.md)).

## Build from source

**Prerequisites**

- [Node.js](https://nodejs.org) 26.13 (see [`.nvmrc`](.nvmrc)) and [pnpm](https://pnpm.io) 12
- [Rust](https://rustup.rs) 1.90 or newer
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

```sh
git clone https://github.com/TheoBIET/OpenVI.git
cd OpenVI
pnpm install
pnpm dev          # runs the desktop app with hot reload
```

| Command                                                              | What it does                              |
| -------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm dev`                                                           | Desktop app in development mode           |
| `pnpm --filter @openvi/desktop build:desktop`                        | Release build and installers for your OS  |
| `pnpm lint` · `pnpm check-types`                                     | Lint (oxlint) and type-check the frontend |
| `pnpm format`                                                        | Format with oxfmt                         |
| `cargo clippy --workspace -- -D warnings` · `cargo test --workspace` | Lint and test the Rust backend            |

## Project layout

```text
apps/desktop/          the app
  src/                 React UI (explorer components, lib/)
  src-tauri/           Rust backend: Tauri commands, file system access
packages/typescript/   shared TypeScript configuration
docs/                  architecture and legal notes
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: the clean-room rules in particular are not
negotiable. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through
[SECURITY.md](SECURITY.md).

## Acknowledgements

OpenVI stands on the research of the GTA VI reverse-engineering community, in particular
[SixNG](https://github.com/holdmysocks/SixNG) (format decoders, OpenVI's core),
[bcpack-rs](https://github.com/Ahmet-Dedeler/bcpack-rs),
[GTA6-Asset-Info](https://github.com/TrinitronClient/GTA6-Asset-Info) and the list at
[awesome-gta6-reverse-engineering](https://github.com/Ahmet-Dedeler/awesome-gta6-reverse-engineering).
The explorer layout pays tribute to [OpenIV](https://openiv.com); OpenVI is not affiliated with it.

## License

OpenVI is free software under the [GNU General Public License v3.0 only](LICENSE).

OpenVI is an unofficial fan project, not affiliated with, endorsed by or sponsored by Rockstar Games, Take-Two
Interactive or the OpenIV team. Grand Theft Auto and related names are trademarks of their respective owners.
OpenVI ships no game files and decrypts nothing: it reads the unencrypted data of files you own, for interoperability
and research.
