import { invoke } from '@tauri-apps/api/core';

export type EntryKind = 'folder' | 'archive' | 'file';

export type Entry = {
  name: string;
  path: string;
  kind: EntryKind;
  /** Bytes on disk; 0 for folders. */
  size: number;
  /** Direct children of a folder; null for files. */
  items: number | null;
};

export type Crumb = { name: string; path: string };

export type Listing = {
  path: string;
  /** From the game folder down to `path`. */
  crumbs: Crumb[];
  /** Folders, then archives, then files; by name within each. */
  entries: Entry[];
};

/** Lists `path`, which must be inside the opened game folder `root` (enforced by the backend). */
export function listDir(root: string, path: string): Promise<Listing> {
  return invoke<Listing>('list_dir', { root, path });
}

/** Folders and archives appear in the tree; plain files only in the list. */
export function isTreeEntry(entry: Entry): boolean {
  return entry.kind !== 'file';
}
