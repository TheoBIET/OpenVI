# Handoff

State of the work and the next task, for whoever picks it up. Update it when you stop.

## State (2026-11-24)

- **Done:** Tauri 2 + React explorer over the folder the user opens: folder tree, details list grouped by type,
  path bar, filter, back / forward / up, keyboard (arrows, Enter, Backspace), status bar, last folder reopened on
  launch. Backend: `list_dir` in `apps/desktop/src-tauri/src/fs.rs`, confined to the opened folder.
- **Done:** a folder holding `common.rpf`, `levels.rpf` and `packs.rpf` is named "GTA VI" in the path bar, tree and
  status bar (file names only, nothing opened); hovering a crumb shows its real path.
- **Done:** formats adapter `crates/openvi-formats` (header, scan, kinds), pinned to SixNG `13de593`, with
  `THIRD_PARTY_NOTICES.md`. `bcpack-rs` is `MIT OR Apache-2.0` at the pinned commit. 3 tests on synthetic bytes.
- **Verified on macOS (Apple Silicon):** `pnpm dev` opens the window and lists a real folder.
- **Verified on Windows 11 (2026-11-24):** `pnpm install`, `pnpm dev`, rustfmt, clippy, `cargo test` (7 tests),
  oxfmt, oxlint and tsc. Windows setup needed: Node 26.13.0 through nvm (`nvm reshim` after installing pnpm), and
  `rustup component add clippy rustfmt`. The maintainer ran the explorer on his files; list timings not recorded.
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

## Next task: check the adapter on real game files

The maintainer tests with his own copy of the game files. Keep everything from them out of the repository
(`.gitignore` blocks the usual extensions; never paste game files or extracted assets into issues or docs).

```powershell
cargo run --release -p openvi-formats --example list_archive -- <game folder>\common.rpf
```

Expected: the header line (table of contents "encrypted (skipped)"), a progress line, then resources counted by kind
with the coverage. Record the time and coverage here; run it twice to see the cache answer instantly.

## Then, in order

1. **Archive view**: double-clicking an `.rpf` opens it as a virtual folder in the explorer: resources grouped by
   kind; columns Name (or hash / offset), Type, Size, Offset; the breadcrumb continues inside the archive. Scans of
   big archives take time: report progress with Tauri events; `scan_archive` already caches each scan (put the cache
   in the app data folder). Add to the adapter: recovered names (`sixng_core::resource::find_resource_name`, then
   `names`, hash → name) and `resource::Resource` for the properties.
2. **Index**: SQLite (`rusqlite`, bundled, FTS5), one database per game version in the app data folder; the filter
   box grows into search.
3. **Viewers**: properties panel; texture preview (PNG); model preview (glTF from `sixng-core` into three.js); text
   tables.
4. **Data-mining views** ([PRODUCT.md](PRODUCT.md)).
5. **Publishing**: green CI, a first tagged release (release workflow), then the GitHub Pages site.

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
