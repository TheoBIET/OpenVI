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
- **Done:** index and search. `crates/openvi-index` (SQLite + FTS5 trigram, one database per game folder) holds
  every scanned archive; opening an archive records it; the toolbar's Index button scans every changed `.rpf` with
  progress in the status bar. Enter in the filter box searches all indexed names; a result opens its archive with the
  resource selected; Back leaves the results. Backend in `apps/desktop/src-tauri/src/index.rs`. 15 Rust tests on
  synthetic bytes. **Not yet seen by eye.**
- **Done:** properties panel. Selecting a resource shows its details; texture dictionaries and models list their
  textures with a decoded PNG preview; XML and text resources show their text. Adapter: `resource_details`,
  `texture_png`, `resource_text`; app: `apps/desktop/src-tauri/src/resource.rs`. Tested on a synthetic texture
  dictionary (64×64 B8G8R8A8). **Not yet seen on real textures or by eye.**
- **Done:** document view. Double-clicking a loose file (text sniffed, images) or an XML, text or PNG resource opens
  it in place of the list: Monaco read-only with the OpenVI theme, Format (XML, JSON), Wrap; images fit or at actual
  size. Text resources up to 8 MB. Seen by the maintainer before Monaco: XML and text read fine.
- **Done (0.3.0):** vehicle catalog. The toolbar's Vehicles button builds it (scans `packs.rpf` and `data.rpf` once)
  and shows a sortable table exported as CSV or JSON; the `vehicles` example writes the same files. Rows come from
  SixNG's `vehicles.json` and `handling.json`, joined in `openvi_formats::catalog::vehicle_rows` (tested on
  hand-written JSON). **Not yet run on complete game files.**
- **Done (0.4.0):** 3D preview. Drawables, fragments and drawable dictionaries open in a three.js view (document
  view); double-clicking a vehicle shows the whole car in any spawn configuration. SixNG exports the GLB into
  `<cache>/work/models` or `<cache>/work/vehicles`; the frontend loads it through the asset protocol (scoped to those
  two folders) so the PNG textures beside it resolve. **Never seen: needs real models.**
- **Verified on macOS (Apple Silicon):** `pnpm dev` opens the window and lists a real folder.
- **Verified on Windows 11 (2026-11-24):** `pnpm install`, `pnpm dev`, rustfmt, clippy, `cargo test` (7 tests),
  oxfmt, oxlint and tsc. Windows setup needed: Node 26.13.0 through nvm (`nvm reshim` after installing pnpm), and
  `rustup component add clippy rustfmt`. The maintainer ran the explorer on his files; list timings not recorded.
  `cargo test` now runs 35 tests.
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

## Next task: check the archive view and the search on real game files

The maintainer tests with his own copy of the game files. Keep everything from them out of the repository
(`.gitignore` blocks the usual extensions; never paste game files or extracted assets into issues or docs).

1. In `pnpm dev`, double-click `common.rpf`: the scan panel shows "Finding resources", then "Reading names", then
   the list grouped by type. Note the time, and check names, sizes and offsets look sane.
2. Go back, reopen it: the cached scan answers at once.
3. Open the biggest archive (`levels.rpf` or `packs.rpf`): note the scan time, and check the list scrolls smoothly
   and the filter stays responsive. The whole listing crosses the IPC as JSON in one piece; if that is slow, page it.
4. Click Index: the status bar follows each archive; afterwards, type a name part (`bench`, `door`) and press
   Enter. Check results, their Archive column, and that double-clicking one opens its archive on it.
   Select a Texture Dictionary: the panel lists its textures and previews them (BC1 and BC4 tiling is verified
   upstream, BC2/3/5/6/7 probable, plain formats unverified). Double-click an XML document, a loose `.xml` or `.txt`, a
   `.png`: each opens in the document view; try Format and Ctrl+F.
5. Without the app: `cargo run --release -p openvi-formats --example list_archive -- <game folder>\common.rpf`
   prints counts by type, how many are named, and the coverage.
6. Vehicles: `cargo run --release -p openvi-formats --example vehicles -- <game folder> <out folder>` writes
   `vehicles.csv` and `vehicles.json` (model, hash, display name, make, handling, colour, rim, tyre, mass, top speed,
   gears). Needs `packs.rpf` complete, and `data.rpf` for display names and handling. Run `list_archive` on
   `levels.rpf` first for more model names.
7. 3D: in `levels.rpf`, double-click a Drawable or a Fragment; in the Vehicles view, double-click a car (the first
   time scans `levels.rpf`, about 3 min). Check scale, orientation, textures, and switch configurations.

Record the results here, fix what breaks, commit.

Results so far (Windows, release build of the example):

| Archive      | Announced entries | Carved resources                  | Coverage | First scan |
| ------------ | ----------------- | --------------------------------- | -------- | ---------- |
| `common.rpf` | 418               | 225 (208 XML, 11 text, 6 binary)  | 85.0 %   | 0.5 s      |
| `levels.rpf` | 2,078             | 46,423 (23,273 models, all named) | 9.2 %    | 175.7 s    |

**These runs used an incomplete copy of the game files**: missing parts read as zeros, so counts and coverage are
not references. SixNG measures `levels.rpf` at 98.3 % coverage, 523,532 entries, 236,604 named, about 3 min. What
the runs do show: the carver and the name pass work on real data (every drawable, fragment and texture dictionary
found carried its name), and a full pass over `levels.rpf` takes about 3 min in release. Redo the table on complete
files; the cache rescans an archive by itself when its size or modification time changes.

Open: `common.rpf` announces 418 entries for 225 carved. Possibly stored (uncompressed) entries, which the zlib
carver cannot see, folders counted in the header, or the missing parts above.

## Then, in order

1. **Check on complete files** (the maintainer's copy is incomplete): the archive view, search, textures, the
   vehicle catalog and the 3D views have only run on synthetic bytes or partial data.
2. **Exports**: save a texture as PNG or DDS, a text resource as a file, a model or vehicle as GLB (copy the export
   out of the work folder; the dialog plugin and `dialog:allow-save` are in).
3. **More catalogs**, like vehicles: weapons (`sixng_core::weapon`), peds and outfits, text tables
   (`sixng_core::text`); then the other data-mining views of [PRODUCT.md](PRODUCT.md).
4. **Hash names**: `sixng_core::names` (hash → name, built from `common.rpf` and `shaders.rpf`) for unnamed
   resources and texture hashes.
5. **Publishing**: green CI, a first tagged release (release workflow), then the GitHub Pages site.

## Open questions for the maintainer

- The index is per game folder; a per-version index (to diff updates) needs a way to read the game version.
- Code signing for releases (macOS notarisation, Windows); builds are unsigned for now.

## Working with the maintainer

- Talk to him in French, briefly. He is a fullstack developer, not a game or shader developer: explain format
  concepts with web analogies.
- He judges the UI by eye: keep it a dense desktop explorer (see [PRODUCT.md](PRODUCT.md#visual-identity)).
- Commits follow the `gitmoji` skill. In this repository he allows `Co-Authored-By` trailers, unlike the skill's
  default.
- Commit after each working step, and version as you go: `pnpm bump <x.y.z>` (sets every package version and fails
  if one is out of step), a `CHANGELOG.md` entry and an annotated `vX.Y.Z` tag (minor per
  feature, patch per fix). Tags stay local: pushing a `v*` tag runs the release workflow, so only he pushes them.

## Suggested skills

`tauri-v2` (backend and commands), `tdd` (adapter and index), `gitmoji` (commits), `impeccable` or `frontend-design`
(UI work), `handoff` (end of session).
