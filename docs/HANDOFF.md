# Handoff

State of the work and the next task, for whoever picks it up. Update it when you stop.

## State (2026-11-24)

- **Done:** Tauri 2 + React explorer over the folder the user opens: folder tree, details list grouped by type,
  path bar, filter, back / forward / up, keyboard (arrows, Enter, Backspace), status bar, last folder reopened on
  launch. Backend: `list_dir` in `apps/desktop/src-tauri/src/fs.rs`, confined to the opened folder.
- **Done:** a folder holding `common.rpf`, `levels.rpf` and `packs.rpf` is named "GTA VI" in the path bar, tree and
  status bar (file names only, nothing opened); hovering a crumb shows its real path.
- **Done:** formats adapter `crates/openvi-formats` (header, scan, kinds, recovered names), pinned to SixNG
  `13de593`, with `THIRD_PARTY_NOTICES.md`. `bcpack-rs` is `MIT OR Apache-2.0` at the pinned commit.
- **Done:** archive view. Double-clicking an `.rpf` (list or tree) opens it like a folder: resources grouped by type
  (Drawable, Fragment, Texture Dictionary, DDS Texture, ...), columns Name, Type, Size, Offset; unnamed resources go
  by their offset, dimmed. First opening shows a scan panel with progress; the scan is cached in the app cache
  folder. Backend `open_archive` in `apps/desktop/src-tauri/src/archive.rs`; the list is virtualised. 10 Rust tests
  on synthetic bytes. **Not yet seen on real archives or by eye.**
- **Verified on macOS (Apple Silicon):** `pnpm dev` opens the window and lists a real folder.
- **Verified on Windows 11 (2026-11-24):** `pnpm install`, `pnpm dev`, rustfmt, clippy, `cargo test` (7 tests),
  oxfmt, oxlint and tsc. Windows setup needed: Node 26.13.0 through nvm (`nvm reshim` after installing pnpm), and
  `rustup component add clippy rustfmt`. The maintainer ran the explorer on his files; list timings not recorded.
  `cargo test` now runs 13 tests.
- **Never run yet:** Linux builds, the release workflow, installers, code signing. CI runs from the first push to
  <https://github.com/TheoBIET/OpenVI>.

## Run on Windows

Needs Git, Rust 1.90+ (MSVC), Visual Studio 2022 Build Tools with the C++ workload, and WebView2 (part of
Windows 11).

```powershell
winget install --id OpenJS.NodeJS.LTS -e   # Node 26.x; .nvmrc pins 26.13.0, another 26.x patch only warns
npm install -g pnpm@12.16.1                 # Node 25+ no longer bundles corepack
git clone https://github.com/TheoBIET/OpenVI.git; cd OpenVI
pnpm install                                # also installs the git hooks
npx skills install                          # restores the agent skills from skills-lock.json
pnpm dev
```

If PowerShell refuses to run `pnpm`: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Next task: check the archive view on real game files

The maintainer tests with his own copy of the game files. Keep everything from them out of the repository
(`.gitignore` blocks the usual extensions; never paste game files or extracted assets into issues or docs).

1. In `pnpm dev`, double-click `common.rpf`: the scan panel shows "Finding resources", then "Reading names", then
   the list grouped by type. Note the time, and check names, sizes and offsets look sane.
2. Go back, reopen it: the cached scan answers at once.
3. Open the biggest archive (`levels.rpf` or `packs.rpf`): note the scan time, and check the list scrolls smoothly
   and the filter stays responsive. The whole listing crosses the IPC as JSON in one piece; if that is slow, page it.
4. Without the app: `cargo run --release -p openvi-formats --example list_archive -- <game folder>\common.rpf`
   prints counts by type, how many are named, and the coverage.

Record the results here, fix what breaks, commit.

## Then, in order

1. **Index**: SQLite (`rusqlite`, bundled, FTS5), one database per game version in the app data folder; the filter
   box grows into search. Add hash → name lookups (`sixng_core::names`) to the adapter.
2. **Viewers**: properties panel (`sixng_core::resource::Resource`); texture preview (PNG); model preview (glTF from
   `sixng-core` into three.js); text tables.
3. **Data-mining views** ([PRODUCT.md](PRODUCT.md)).
4. **Publishing**: green CI, a first tagged release (release workflow), then the GitHub Pages site.

## Open questions for the maintainer

- Code signing for releases (macOS notarisation, Windows); builds are unsigned for now.

## Working with the maintainer

- Talk to him in French, briefly. He is a fullstack developer, not a game or shader developer: explain format
  concepts with web analogies.
- He judges the UI by eye: keep it a dense desktop explorer (see [PRODUCT.md](PRODUCT.md#visual-identity)).
- Commits follow the `gitmoji` skill. In this repository he allows `Co-Authored-By` trailers, unlike the skill's
  default.

## Suggested skills

`tauri-v2` (backend and commands), `tdd` (adapter and index), `gitmoji` (commits), `impeccable` or `frontend-design`
(UI work), `handoff` (end of session).
