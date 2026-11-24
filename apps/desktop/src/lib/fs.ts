import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type EntryKind = 'folder' | 'archive' | 'file' | 'resource';

export type Entry = {
  name: string;
  /** Unique in a listing. For a resource: the archive path, `#`, its offset in hex. */
  path: string;
  kind: EntryKind;
  /** Bytes on disk; 0 for folders. For a resource, its inflated size. */
  size: number;
  /** Direct children of a folder; null for files. */
  items: number | null;
  /** A resource's offset in its archive. */
  offset?: number;
  /** A resource's type, as the "Type" column shows it. */
  typeName?: string;
};

export type Crumb = { name: string; path: string };

export type Listing = {
  /** The folder or the archive listed. */
  path: string;
  /** From the game folder down to `path`. */
  crumbs: Crumb[];
  /** Folders, then archives, then files; by name within each. Resources by type, then name. */
  entries: Entry[];
};

/** Progress of an archive's first scan: carving counts bytes, naming counts resources. */
export type ScanProgress = {
  archive: string;
  phase: 'carving' | 'naming';
  done: number;
  total: number;
};

export function isArchivePath(path: string): boolean {
  return path.toLowerCase().endsWith('.rpf');
}

/** Lists `path`, which must be inside the opened game folder `root` (enforced by the backend). */
export function listDir(root: string, path: string): Promise<Listing> {
  return invoke<Listing>('list_dir', { root, path });
}

/** Lists the resources of the archive at `path`; the first opening scans it (see {@link onArchiveProgress}). */
export function openArchive(root: string, path: string): Promise<Listing> {
  return invoke<Listing>('open_archive', { root, path });
}

/** A folder or an archive, whichever `path` is. */
export function listPath(root: string, path: string): Promise<Listing> {
  return isArchivePath(path) ? openArchive(root, path) : listDir(root, path);
}

export function onArchiveProgress(handler: (progress: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>('archive-progress', (event) => handler(event.payload));
}

/** Folders and archives appear in the tree; files and resources only in the list. */
export function isTreeEntry(entry: Entry): boolean {
  return entry.kind === 'folder' || entry.kind === 'archive';
}
