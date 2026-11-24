# Changelog

Each version is a git tag (`vX.Y.Z`); while OpenVI is 0.x, a feature bumps the minor version and a fix the patch.

## 0.12.0 (2026-11-24)

- Faster: scan indexes stay in memory (an archive's index was parsed again, up to hundreds of MB, for every resource
  opened, model previewed or character assembled); textures decoded for one look, clip or configuration are reused
  by the next; every dependency is optimised in `pnpm dev`; Monaco and three.js load in the background after start-up.
- The sections' progress bar follows every step (scans, waiting for a scan started elsewhere, indexing, decoding,
  listing, reading names, exporting), with a count when there is one and a sweeping bar otherwise.
- The app's tests start on Windows again (Windows manifest embedded in every executable).

## 0.11.0 (2026-11-24)

- The model on screen stays while the next one loads: changing parts, configuration, clip or selection keeps it,
  blurred under a spinner, until the new one fades in over it.
- Loading reserves its space: the 3D view's frame with a skeleton stage on first load, skeleton rows and sections in
  the preview pane, code-shaped skeletons for documents and the editor; nothing jumps when content arrives.
- Vehicles and Characters follow the arrow keys and open on Enter.

## 0.10.0 (2026-11-24)

- Preview pane on the right everywhere: a click selects and previews (folders and archives, loose text and image
  files, resources with their 3D model turning, text, image or textures, vehicles and characters with their data and
  model); the pane's Open button opens the item on its own, as a double-click does.

## 0.9.0 (2026-11-24)

- Animations section: the clip dictionaries of `anim.rpf` (filter by name), the clips of the one picked, and the clip
  played on a character (guessed from the dictionary name, or picked) or on its skeleton alone. The first listing
  reads every dictionary's name (about a minute) and is cached until `anim.rpf` changes.

## 0.8.0 (2026-11-24)

- Characters section: every character and animal SixNG can assemble from `packs.rpf` (filter by name, characters or
  animals). Double-click shows one assembled in 3D, its face applied to the head; the Parts panel wears one part per
  slot (head, hair, top, bottom, feet... or none) and applies the look on demand.

## 0.7.0 (2026-11-24)

- Section tabs under the toolbar: Explorer and Vehicles, with Characters, Weapons and Animations to come. Catalogs
  take the whole width; Vehicles leaves the toolbar for its tab.
- Animation player in the 3D view, for models that carry animations: clip (or rest pose), play and pause, time line,
  speed from ×0.25 to ×2.

## 0.6.2 (2026-11-24)

- Model textures come from the texture stores (`data/ttdb/*.ttpf`), not the archives: model exports are redone when a
  store changes, so a model exported while its store was missing or downloading gets its textures later.
- Materials panel in the 3D view: every material with its texture slots, role, size, status and thumbnail; a texture
  "not in any ttpf store" means its store is missing or incomplete (restart OpenVI once it is downloaded).

## 0.6.1 (2026-11-24)

- 3D models show their textures: they all failed to load before, and models looked white.
- The render mode is picked from a dropdown; the header counts the model's textures and lists missing ones.

## 0.6.0 (2026-11-24)

- 3D render modes: Lit (textures and lights), Unlit (textures only), Clay (grey shape), Normals (surface
  directions as colours) and Wire (triangle edges), kept from one model to the next.

## 0.5.1 (2026-11-24)

- Model and vehicle exports follow their archive: one that changes (a download finishing, a game update) gets fresh
  exports instead of reusing stale ones, and the vehicle tables are rebuilt when `packs.rpf` or `data.rpf` changes.

## 0.5.0 (2026-11-24)

- Exports: Save raw writes any resource inflated, Save PNG writes the shown texture at full size, and the 3D view's
  Export copies a model or vehicle (GLB and textures) to a folder.

## 0.4.0 (2026-11-24)

- 3D preview: drawables, fragments and drawable dictionaries open in an orbitable three.js view with their textures
  (wireframe, reframe, triangle count and size).
- Vehicles in 3D: double-clicking a vehicle of the catalog shows the whole car with its wheels, in any of its spawn
  configurations; Resources searches its model's resources.
- Models are exported by SixNG into the app cache and reused on the next opening.

## 0.3.0 (2026-11-24)

- Vehicles view: the toolbar's Vehicles button shows the vehicle catalog as a sortable table (name, model, make,
  handling, mass, top speed, gears, configurations, colour), narrowed by the filter box and exported as CSV or JSON.
  Double-clicking a vehicle searches its model's resources. The archives it needs are scanned once and indexed.
- The `vehicles` example writes the same catalog as CSV and JSON without the app.
- Both come from SixNG's decoding of the vehicle tables (`packs.rpf`) and the game text and handling records
  (`data.rpf`).
- Scans are cached in SixNG's work layout (`work/index`); the old cache folder moves there once.
- `pnpm bump <x.y.z>` sets the version everywhere and fails if a file is out of step.

## 0.2.1 (2026-11-24)

- Opening an archive while another is still being scanned no longer makes the scan panel jump between the two; the
  tree highlights the archive being opened at once.
- One scan per archive at a time: reopening or indexing an archive during its scan waits for it and reads its cache.

## 0.2.0 (2026-11-24)

- Archive view: double-clicking an `.rpf` opens it like a folder. Resources are found by scanning the unencrypted
  data area (the encrypted table of contents is skipped), grouped by type, named from their own data where they
  carry a name; the first scan shows its progress and is cached.
- Index and search: the Index button scans every archive into a local SQLite index; Enter in the filter box searches
  names across all archives, and a result opens its archive on the resource.
- Properties panel: details of the selected resource, and the textures of texture dictionaries and models with a
  decoded preview.
- Document view: loose files (text, images) and XML, text and PNG resources open in place of the list; text in a
  read-only Monaco editor with highlighting, XML and JSON formatting and word wrap.
- List groups fold and unfold; the current group's header stays pinned while scrolling.
- A folder holding the GTA VI archives is named "GTA VI" in the path bar.
- New visual identity: Barlow, Barlow Condensed and Geist Mono; neutral greys with a magenta, violet and cyan accent;
  new app icon.
- Formats adapter `crates/openvi-formats` over SixNG (pinned), index `crates/openvi-index`.
- Windows: verified build and setup.

## 0.1.0

- Explorer over the game folder: folder tree, details list grouped by type, path bar, filter, back, forward and up,
  keyboard navigation, status bar; the last folder reopens on launch.
