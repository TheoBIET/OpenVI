import { invoke } from '@tauri-apps/api/core';

/** One object of a scene. */
export type SceneMember = {
  /** Its handle in the scene (`lucia`, `prop_am_drink_soda_03a`). */
  handle: string;
  /** `character` (can play the scene in 3D), `ped`, `prop` or `unknown`. */
  kind: string;
  model: string | null;
  clips: string[];
};

/** One cutscene of the story pack. */
export type Cutscene = {
  name: string;
  variantOf: string | null;
  /** Camera cuts. */
  sections: number;
  cast: SceneMember[];
  props: SceneMember[];
  cameras: number;
  setModels: string[];
  /** Clip windows whose animation is missing (an incomplete pack). */
  missing: number;
};

let pending: Promise<Cutscene[]> | null = null;
let pendingRoot = '';

/** Every cutscene of the game folder `root` (scans the story pack first; a few minutes the first time). */
export function cutsceneList(root: string): Promise<Cutscene[]> {
  if (!pending || pendingRoot !== root) {
    pendingRoot = root;
    pending = invoke<Cutscene[]>('cutscenes', { root });
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** The GLB of cast member `handle` playing scene `scene`. */
export function cutscenePreview(root: string, scene: string, handle: string): Promise<string> {
  return invoke<string>('cutscene_preview', { root, scene, handle });
}
