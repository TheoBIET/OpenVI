import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { Entry } from './fs';

/** What the index of the opened game folder holds. */
export type IndexStatus = { archives: number; resources: number; named: number };

/** One step of an indexing pass; `phase` is null while an archive is checked or stored. */
export type IndexProgress = {
  archive: string;
  position: number;
  count: number;
  phase: 'carving' | 'naming' | null;
  done: number;
  total: number;
};

export type IndexReport = { archives: number; indexed: number; unchanged: number; failed: string[] };

/** Resources whose name contains the query; each carries its archive in `location`. */
export type SearchView = { entries: Entry[]; truncated: boolean };

/** Scans every archive of `root` that changed since it was last indexed (see {@link onIndexProgress}). */
export function indexGame(root: string): Promise<IndexReport> {
  return invoke<IndexReport>('index_game', { root });
}

export function searchIndex(root: string, query: string): Promise<SearchView> {
  return invoke<SearchView>('search_index', { root, query });
}

export function indexStatus(root: string): Promise<IndexStatus> {
  return invoke<IndexStatus>('index_status', { root });
}

export function onIndexProgress(handler: (progress: IndexProgress) => void): Promise<UnlistenFn> {
  return listen<IndexProgress>('index-progress', (event) => handler(event.payload));
}

/** The archive a resource path (`<archive>#<offset>`) belongs to. */
export function archiveOf(resourcePath: string): string {
  const hash = resourcePath.lastIndexOf('#');
  return hash === -1 ? resourcePath : resourcePath.slice(0, hash);
}
