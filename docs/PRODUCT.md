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
- On the GitHub Pages site (`apps/site`, a presentation page today): a generated catalog (names, hashes, categories:
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
- Section tabs under the toolbar: Explorer (the layout above), then one tab per catalog of game data for a broader
  audience: Vehicles, Characters, Weapons, Animations. Catalogs take the whole width (no folder tree) and open their
  items in the same viewers as the explorer.
- The 3D view plays the animations a model carries (clip, play and pause, time line, speed).
- Everywhere, a click selects and the right-hand pane previews the selection (a 3D model turns slowly); its Open
  button, or a double-click, opens the item on its own in place of the list.
- Loading never blanks what is on screen and never moves the layout: content being replaced stays, blurred under a
  spinner (`BusyOverlay`); content not there yet has a skeleton of its final size (`components/skeleton.tsx`). 3D
  views are double-buffered (`useBufferedScene`).
- Tokens, fonts and accent utilities live in `packages/theme/theme.css` (`@openvi/theme`), shared by the app and the
  website; Monaco's theme (`apps/desktop/src/lib/monaco.ts`) repeats them.
- Type: Barlow (400–700) for all text, 14 px, line height 1.5; Barlow Condensed 700 for page titles and the logo
  (`font-display`: uppercase, 0.01em tracking, 0.95 line height); Barlow 600 for section titles (`font-title`); Geist
  Mono for code, identifiers, offsets and hashes (`font-mono`). Fonts are bundled (Fontsource), never fetched.
- Accent: magenta `#ff4fa3` → violet `#a855f7` → cyan `#38d6ff` at 90deg. `bg-accent-gradient` for the brand line,
  main buttons and progress; `text-accent-gradient` for the logo text. `primary` is the first colour (selection,
  focus); `accent-solid` (`#dd5593`) for small accent text such as group headers; text on the gradient is `#1d0a12`.
- Surfaces are neutral greys: background `#121212`, card `#171717`, popover `#1b1b1b`, secondary `#1e1e1e`, muted
  `#252525`, border `#2d2d2d`, input `#383838`; muted text `#9c9c9c`, main text `#f0f0f0`; dark colour scheme.
- Semantic colours: `destructive` `#f0735f` (errors), `warning` `#e2ad4b` (warnings and notices), `live` `#3fd6f2`
  (presence only), `highlight` = the cyan.
- Details: three accent halos at the top of the window (13 %, 9 %, 11 % at 10 %, 55 %, 95 % of the width); text
  selection in the first accent at 45 %; keyboard focus a 2 px outline in it, 2 px off; radii 5 / 7.5 / 10 / 12.5 /
  15 px (`sm` to `2xl`); thin scrollbars in `muted`; `data-reduce-motion="true"` turns animations off.
- Explorer colours: folders violet, archives magenta, models cyan, other files muted.
- No Rockstar logo, typeface, or "VI" lettering that imitates the game's logo.
