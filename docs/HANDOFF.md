# Handoff

State of the work and the next task, for whoever picks it up. Update it when you stop.

## State (2026-11-24)

- **Done:** Tauri 2 + React explorer over the folder the user opens: folder tree, details list grouped by type,
  path bar, filter, back / forward / up, keyboard (arrows, Enter, Backspace), status bar, last folder reopened on
  launch. Backend: `list_dir` in `apps/desktop/src-tauri/src/fs.rs`, confined to the opened folder.
- **Verified on macOS (Apple Silicon):** `pnpm dev` opens the window and lists a real folder; rustfmt, clippy,
  `cargo test` (3 tests), oxfmt, oxlint and tsc pass.
- **Never run yet:** Windows and Linux builds, the release workflow, installers, code signing. CI runs from the first
  push to <https://github.com/TheoBIET/OpenVI>.

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

## Next task: smoke test with real game files

The maintainer tests with his own copy of the game files. Keep everything from them out of the repository
(`.gitignore` blocks the usual extensions; never paste game files or extracted assets into issues or docs).

1. **Open** the game folder. Expected: `.rpf` files grouped under "Rage Package File" with their sizes.
2. **Navigate** a few levels: double-click, breadcrumb, back / forward / up, Backspace, arrows, Enter, filter.
3. **Measure** how long the largest folder takes to list, and note anything wrong (paths, sizes, icons, layout at
   high DPI).
4. **Restart** the app: the last folder reopens.

Fix what breaks on Windows, record the results here, commit.

## Then, in order

1. **Formats adapter** (`crates/openvi-formats`): depend on `sixng-core` by git, pinned to one commit, with
   `default-features = false` (skips libopus and CMake). It is the only caller of `sixng-core`
   ([ARCHITECTURE.md](ARCHITECTURE.md)). Start with one archive: `rpf9` (header), `scan` (carves the zlib streams of
   the data area; streamed, parallel segments, resumable), `classify::Kind` (resource type), `resource::Resource`,
   `names` (hash → name). SixNG `master` was at `d2ff12a` when this was written; pick and record your own pin.
   Add `THIRD_PARTY_NOTICES.md` (SixNG is GPL-3.0-only; check the licence of `bcpack-rs`, which GitHub reports as
   unknown, before any release).
   _Done when_ a test on synthetic bytes passes and, with real game files, one archive lists its resources by kind.
2. **Archive view**: double-clicking an `.rpf` opens it as a virtual folder in the explorer: resources grouped by
   kind; columns Name (or hash / offset), Type, Size, Offset; the breadcrumb continues inside the archive. Scans of
   big archives take time: report progress with Tauri events and cache each archive's scan.
3. **Index**: SQLite (`rusqlite`, bundled, FTS5), one database per game version in the app data folder; the filter
   box grows into search.
4. **Viewers**: properties panel; texture preview (PNG); model preview (glTF from `sixng-core` into three.js); text
   tables.
5. **Data-mining views** ([PRODUCT.md](PRODUCT.md)).
6. **Publishing**: green CI, a first tagged release (release workflow), then the GitHub Pages site.

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
