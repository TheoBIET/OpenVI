# OpenVI

Open-source (GPL-3.0-only) desktop explorer and data-mining toolkit for GTA VI files, in the OpenIV tradition:
Tauri 2 app, Rust backend, React 19 + Tailwind 4 UI, pnpm + turbo monorepo.

## Where things are

- `apps/desktop/src/`: React UI. Explorer components in `components/`, Tauri calls and formatting in `lib/`.
- `apps/desktop/src-tauri/src/`: Rust backend, one module per concern (`fs.rs`: folder listings).
- `docs/HANDOFF.md`: current state and the next task. Read it first when you pick up the work.
- `docs/PRODUCT.md`: what OpenVI is for, goals, non-goals, visual identity. Read it before proposing a feature.
- `docs/ARCHITECTURE.md`: decisions and data flow. Read it before adding a module or a dependency.
- `docs/LEGAL.md`: clean-room rules. Read it before touching anything that reads game files.
- Commands: root `package.json` scripts; Rust: `cargo clippy --workspace -- -D warnings`, `cargo test --workspace`.
- Agent skills are not committed: after cloning, `npx skills install` restores them from `skills-lock.json`.

## Rules

- **Clean-room.** OpenVI reads unencrypted data and skips encrypted blocks untouched. Test fixtures are synthetic
  bytes. The repository holds no decryption code, keys, game files or extracted assets.
- **Explorer first.** New features extend the explorer (a view, a panel, a column) in its dense, desktop-tool style.
- **One door to the formats.** All game-format decoding goes through the backend's formats adapter, the only caller
  of `sixng-core`.
- **Visual identity** follows `docs/PRODUCT.md`; colours come from the tokens in `src/styles.css`.
- English for code, comments, docs and commits. Commits follow the `gitmoji` skill.
- Done means `pnpm format:check`, `pnpm lint`, `pnpm check-types`, clippy and `cargo test` all pass.
