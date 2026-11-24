# Product notes

Decisions taken with the maintainer, and why. Read before proposing a feature.

## What OpenVI is

A desktop **file explorer** for a GTA VI install, in the OpenIV tradition, that grows into a **data-mining
workbench**. The explorer is the product's backbone; every other feature is a view or panel inside it.

## Goals

1. **Explore** the folders and RPF9 archives of the user's own install: tree, grouped details list, path bar,
   filter, history, status bar.
2. **Look inside archives**: resources by type with recovered names; preview 3D models, textures and game text;
   export glTF, PNG / DDS, JSON / CSV locally.
3. **Data mining**: find vehicles, weapons, missions and hidden content, with their ids and hashes.
   _Hidden content_ means present in the files but referenced by nothing the player sees: a model never placed on the
   map, a text label never shown, a vehicle with handling data and no spawn.

## Later

- A searchable index across all archives, and diffs between game versions ("what changed in this update").
- A map viewer in the spirit of CodeWalker.
- A GitHub Pages site: a landing page with downloads, possibly a generated catalog (names, hashes, categories:
  facts only, never assets).
- Modding through a PC compatibility layer's file overlay. Rewriting RPF9 archives is out of reach: their table of
  contents is encrypted.

## Non-goals and anti-goals

- Anything that would draw a cease-and-desist: decryption, keys, circumvention, shipping or publishing game files or
  extracted assets ([LEGAL.md](LEGAL.md)).
- A casual, app-like UI (tabs, cards, marketing copy). OpenVI is a dense desktop tool.

## Visual identity

- Layout like OpenIV: folder tree on the left, a details list grouped by type on the right, path bar and filter on
  top, status bar at the bottom.
- GTA VI mood, used lightly: violet-tinted night greys; sunset accents (`flamingo` → `sunset` → `gold`) for the brand
  line, the logo, group headers and the selection; `lagoon` teal as the cool accent. Tokens live in
  `apps/desktop/src/styles.css`.
- No Rockstar logo, typeface, or "VI" lettering that imitates the game's logo.
