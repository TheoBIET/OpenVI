import { invoke } from '@tauri-apps/api/core';

export type MapSummary = {
  entities: number;
  models: number;
  files: number;
  /** `[min x, min y, max x, max y]`, metres. */
  bounds: [number, number, number, number];
};

export type MapInfo = { summary: MapSummary; models: string[] };

/** The map of `root` (the first call reads every map file of levels.rpf: a few minutes). */
export function mapInfo(root: string): Promise<MapInfo> {
  return invoke<MapInfo>('map_info', { root });
}

/** The map's entities: 16 bytes each (x, y, z as f32, model index as u32). */
export function mapPoints(root: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('map_points', { root });
}

/** Entry `index` of a typed array (0 past its end). */
export function at(array: Float32Array | Uint32Array, index: number): number {
  return array[index] ?? 0;
}
