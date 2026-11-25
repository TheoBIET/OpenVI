import { invoke } from '@tauri-apps/api/core';

/** A generic garment: worn by any ped of its fit. */
export type Garment = {
  /** Its drawable name (`tshirtcrewneck_mr1_004_…`): the id. */
  name: string;
  offset: number;
  /** The item word (`tshirtcrewneck`) and the same in words (`tshirt crewneck`). */
  item: string;
  label: string;
  slot: 'full' | 'outer' | 'top' | 'bottom' | 'feet';
  /** Fit tag (`mr1`) and the sex it is cut for. */
  fit: string;
  sex: 'male' | 'female';
  variant: string;
};

/** How the list names a slot. */
export const slotLabel: Record<Garment['slot'], string> = {
  full: 'One-piece',
  outer: 'Outerwear',
  top: 'Top',
  bottom: 'Bottom',
  feet: 'Shoes',
};

const lists = new Map<string, Promise<Garment[]>>();

/** Every generic garment of the game folder `root` (scans packs.rpf first when needed). */
export function garmentList(root: string): Promise<Garment[]> {
  let pending = lists.get(root);
  if (!pending) {
    pending = invoke<Garment[]>('clothes', { root });
    pending.catch(() => lists.delete(root));
    lists.set(root, pending);
  }
  return pending;
}

/** The GLB of garment `name` worn by a mannequin of its fit. */
export function garmentPreview(root: string, name: string): Promise<string> {
  return invoke<string>('garment_preview', { root, name });
}
