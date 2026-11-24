import { invoke } from '@tauri-apps/api/core';

/** One clip dictionary of anim.rpf (`gameplay@locomotion@female_character@...`). */
export type ClipDictionary = { name: string; id: string };

/** One clip of a dictionary (`move`, `idle`...), its length in seconds. */
export type Clip = { name: string; duration: number };

const lists = new Map<string, Promise<ClipDictionary[]>>();

/** Every clip dictionary of the game folder `root` (scans anim.rpf first; the first listing takes about a minute). */
export function animationDictionaries(root: string): Promise<ClipDictionary[]> {
  let pending = lists.get(root);
  if (!pending) {
    pending = invoke<ClipDictionary[]>('animation_dictionaries', { root });
    pending.catch(() => lists.delete(root));
    lists.set(root, pending);
  }
  return pending;
}

export function animationClips(root: string, dictionary: string): Promise<Clip[]> {
  return invoke<Clip[]>('animation_clips', { root, dictionary });
}
