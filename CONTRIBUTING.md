# Contributing to OpenVI

Thanks for helping. This page covers setup, the rules every change follows, and how to send it.

## Ground rules

1. **Clean-room, always.** Read [docs/LEGAL.md](docs/LEGAL.md). No decryption code, no keys, no game files or
   extracted assets, anywhere: code, tests, issues, pull requests, screenshots of dumped assets. A pull request that
   breaks this rule is closed.
2. **Search first.** Look at open issues and pull requests before starting; for anything bigger than a small fix,
   open an issue with a short plan so the work is not done twice.
3. **One change per pull request**, small enough to review. A fix, a feature and a refactor are three pull requests.

## Setup

See [Build from source](README.md#build-from-source). `pnpm install` also installs the git hooks:

- **pre-commit** checks formatting (oxfmt) and lint (oxlint) on the staged files;
- **pre-push** runs the type check, the tests, `cargo clippy -- -D warnings` and `cargo test`.

## Code style

- TypeScript and React: formatted by oxfmt (`pnpm format`), linted by oxlint. Components stay small and typed.
- Rust: `rustfmt` (120 columns) and `cargo clippy --workspace -- -D warnings`.
- Code, comments, docs and commit messages are in English.
- Game-format decoding goes through the backend's formats adapter, never directly from a command or the UI
  ([ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Tests

- A bug fix comes with a test that fails before the fix.
- Rust tests build their own fixtures (synthetic bytes in a temporary folder), never game data.

## Commits

Commits use [gitmoji](https://gitmoji.dev): `<emoji> <message>`, lowercase, imperative, at most 50 characters,
one idea per commit.

```text
✨ add archive index for rpf9 resources
🐛 keep tree selection after refresh
📝 document the formats adapter
```

## Pull requests

Describe what changes and why, how you tested it (OS, commands and results), and what you could not test.
AI-assisted contributions are welcome when you have read and understood every line you submit; say which tool you used.
