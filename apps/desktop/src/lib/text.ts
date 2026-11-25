import { invoke } from '@tauri-apps/api/core';

/** One string of the game. */
export type TextLine = {
  /** Hash of its label, 8 hex digits. */
  label: string;
  /** Without markup. */
  text: string;
  /** As stored, markup included (`~n~`, `~sl:…~` timings, button codes). */
  raw: string;
  /** The table holding it (`data.rpf@<offset>`). */
  table: string;
};

export type TextSearch = { total: number; lines: TextLine[]; searched: number };

/** The game's English strings matching `query` (any case, or a label hash); best matches first. */
export function gameText(root: string, query: string): Promise<TextSearch> {
  return invoke<TextSearch>('game_text', { root, query });
}
