import { invoke } from '@tauri-apps/api/core';

/** One weapon model, built from parts (receiver, barrel, stock…). */
export type Weapon = {
  /** Its name without level suffix (`w_ar_adb_01`): the id. */
  name: string;
  /** Class code from the name (`ar`) and its meaning (`Assault rifle`). */
  class: string;
  className: string;
  /** The word after the class (`adb`), often the make. */
  make: string;
  archive: string;
  /** The model it is built on (`w_ar_adb_01_hi`). */
  model: string;
  parts: number;
  slots: number;
};

/** One part a weapon can be built with; parts of one group (slot) replace each other. */
export type WeaponPart = { offset: number; name: string; group: string; label: string; default: boolean };

/** A weapon assembled: the manifest the 3D view loads, and parts that found no mount. */
export type WeaponAssembly = { manifest: string; unmounted: string[] };

const lists = new Map<string, Promise<Weapon[]>>();

/** Every weapon of the game folder `root` (scans data.rpf and packs.rpf first when needed). */
export function weaponList(root: string): Promise<Weapon[]> {
  let pending = lists.get(root);
  if (!pending) {
    pending = invoke<Weapon[]>('weapons', { root });
    pending.catch(() => lists.delete(root));
    lists.set(root, pending);
  }
  return pending;
}

export function weaponParts(root: string, name: string): Promise<WeaponPart[]> {
  return invoke<WeaponPart[]>('weapon_part_list', { root, name });
}

/** Weapon `name` built with `parts` (offsets), or its default build when `parts` is null. */
export function weaponPreview(root: string, name: string, parts: number[] | null): Promise<WeaponAssembly> {
  return invoke<WeaponAssembly>('weapon_preview', { root, name, parts });
}
