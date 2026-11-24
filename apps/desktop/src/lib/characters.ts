import { invoke } from '@tauri-apps/api/core';

/** A character or an animal the game's parts assemble into, or a ped model of the game's outfit list. */
export type Character = {
  /** Name prefix or model name (`ped_0x<hash>` when no name is known). */
  name: string;
  /** `model`: a ped model dressed from its outfits rather than parts named after it. */
  kind: 'character' | 'animal' | 'model';
  parts: number;
  defaultParts: number;
  /** The name the game shows ("Mandy"), where the data gives one. */
  display: string | null;
  outfits: number;
  /** The model name may be a chance hash hit. */
  uncertain: boolean;
};

/** One part a character can wear; parts of one group replace each other (one per group, or none). */
export type CharacterPart = { offset: number; name: string; group: string; label: string; default: boolean };

const lists = new Map<string, Promise<Character[]>>();

/** Every character, animal and ped model of the game folder `root` (scans packs.rpf and data.rpf first when needed). */
export function characterList(root: string): Promise<Character[]> {
  let pending = lists.get(root);
  if (!pending) {
    pending = invoke<Character[]>('characters', { root });
    pending.catch(() => lists.delete(root));
    lists.set(root, pending);
  }
  return pending;
}

/** One outfit of the game's outfit list: its main garments and the parts (offsets) it wears. */
export type CharacterLook = { label: string; parts: number[] };

export type CharacterParts = { parts: CharacterPart[]; outfits: CharacterLook[] };

/** The parts `name` can wear, by group, and the outfits the game dresses it in. */
export function characterParts(root: string, name: string): Promise<CharacterParts> {
  return invoke<CharacterParts>('character_part_list', { root, name });
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
