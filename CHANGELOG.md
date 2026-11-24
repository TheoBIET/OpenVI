# Changelog

Each version is a git tag (`vX.Y.Z`); while OpenVI is 0.x, a feature bumps the minor version and a fix the patch.

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
