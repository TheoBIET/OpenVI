#!/usr/bin/env node
// Sets the version of every package to the one given, and fails if any file does not hold the version it expects.
// Usage: pnpm bump <x.y.z>   (then add the CHANGELOG entry, commit "🔖 release x.y.z" and tag vx.y.z)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('usage: pnpm bump <x.y.z>');
  process.exit(2);
}

const json = ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json'];
const toml = [
  'apps/desktop/src-tauri/Cargo.toml',
  'crates/openvi-formats/Cargo.toml',
  'crates/openvi-index/Cargo.toml',
];

const current = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version;
const edits = [
  ...json.map((file) => [file, /"version": "[^"]+"/, `"version": "${next}"`]),
  ...toml.map((file) => [file, /^version = "[^"]+"/m, `version = "${next}"`]),
];
for (const [file, pattern, replacement] of edits) {
  const path = `${root}/${file}`;
  const text = readFileSync(path, 'utf8');
  const found = text.match(pattern)?.[0];
  if (!found?.includes(`"${current}"`)) {
    console.error(`${file}: expected version ${current}, found ${found ?? 'none'}`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(pattern, replacement));
}
execFileSync('cargo', ['update', '--workspace', '--quiet'], { cwd: root, stdio: 'inherit' });
console.log(`${current} -> ${next} in ${edits.length} files and Cargo.lock`);
