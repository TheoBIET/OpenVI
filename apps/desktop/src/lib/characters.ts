import { invoke } from '@tauri-apps/api/core';

/** A character or an animal the game's parts assemble into. */
export type Character = { name: string; kind: 'character' | 'animal'; parts: number; defaultParts: number };

/** One part a character can wear; parts of one group replace each other (one per group, or none). */
export type CharacterPart = { offset: number; name: string; group: string; label: string; default: boolean };

const lists = new Map<string, Promise<Character[]>>();

/** Every character and animal of the game folder `root` (scans packs.rpf first when needed). */
export function characterList(root: string): Promise<Character[]> {
  let pending = lists.get(root);
  if (!pending) {
    pending = invoke<Character[]>('characters', { root });
    pending.catch(() => lists.delete(root));
    lists.set(root, pending);
  }
  return pending;
}

export function characterParts(root: string, name: string): Promise<CharacterPart[]> {
  return invoke<CharacterPart[]>('character_part_list', { root, name });
}

/** An animation clip to play on a character, on its skeleton alone when `skeletonOnly`. */
export type ClipChoice = { dictionary: string; clip: string; skeletonOnly: boolean };

/** The GLB of character `name` wearing `parts` (offsets), or its default look when `parts` is null; with `clip` as its animation. */
export function characterPreview(
  root: string,
  name: string,
  parts: number[] | null,
  clip: ClipChoice | null = null,
): Promise<string> {
  return invoke<string>('character_preview', {
    root,
    name,
    parts,
    dictionary: clip?.dictionary ?? null,
    clip: clip?.clip ?? null,
    skeletonOnly: clip?.skeletonOnly ?? false,
  });
}
