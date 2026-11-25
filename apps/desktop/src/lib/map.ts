import { invoke } from '@tauri-apps/api/core';

export type MapSummary = {
  entities: number;
  models: number;
  files: number;
  /** `[min x, min y, max x, max y]`, metres. */
  bounds: [number, number, number, number];
};

/** An interior (a building's inside) placed in the world. */
export type Interior = {
  name: string;
  /** RAGE world space, metres. */
  position: [number, number, number];
  rooms: number;
  entities: number;
  /** Entity sets: optional states (a shop open or closed…). */
  sets: number;
  /** Whether its definition was found. */
  defined: boolean;
};

export type MapInfo = { summary: MapSummary; models: string[]; interiors: Interior[] };

/** The map is large (tens of MB): fetched once per game folder per session. */
const infos = new Map<string, Promise<MapInfo>>();
const buffers = new Map<string, Promise<ArrayBuffer>>();

function cached<T>(memory: Map<string, Promise<T>>, root: string, load: () => Promise<T>): Promise<T> {
  let pending = memory.get(root);
  if (!pending) {
    pending = load();
    pending.catch(() => memory.delete(root));
    memory.set(root, pending);
  }
  return pending;
}

/** The map of `root` (the first call reads every map file of levels.rpf: a few minutes). */
export function mapInfo(root: string): Promise<MapInfo> {
  return cached(infos, root, () => invoke<MapInfo>('map_info', { root }));
}

/** The map's entities: 16 bytes each (x, y, z as f32, model index as u32). */
export function mapPoints(root: string): Promise<ArrayBuffer> {
  return cached(buffers, root, () => invoke<ArrayBuffer>('map_points', { root }));
}

/** An area of the map put together in 3D. */
export type MapArea = { manifest: string; entities: number; models: number; missing: number };

/** The area within `radius` metres of `(x, y)` in 3D (its models are exported the first time: a minute or more). */
export function mapArea(root: string, x: number, y: number, radius: number): Promise<MapArea> {
  return invoke<MapArea>('map_area_preview', { root, x, y, radius });
}

/** Entry `index` of a typed array (0 past its end). */
export function at(array: Float32Array | Uint32Array, index: number): number {
  return array[index] ?? 0;
}
