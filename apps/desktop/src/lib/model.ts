import { invoke } from '@tauri-apps/api/core';

/** The GLB file of the model resource at `path` (`<archive>#<offset>`), exported on first use. */
export function modelPreview(root: string, path: string): Promise<string> {
  return invoke<string>('model_preview', { root, path });
}

/** The GLB file of vehicle `name` in configuration `config`, wheels fitted (scans levels.rpf first if needed). */
export function vehiclePreview(root: string, name: string, config: number): Promise<string> {
  return invoke<string>('vehicle_preview', { root, name, config });
}

/** One texture slot of a material, as the exporter resolved it. */
export type TextureSlot = {
  slot: string;
  role: string | null;
  /** `ok`, `not in any ttpf store` (its store is missing or incomplete), `embedded in the model`... */
  status: string;
  /** The decoded PNG on disk, when there is one. */
  file: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
};

export type MaterialReport = { index: number; shader: string; class: string | null; textures: TextureSlot[] };

/** The materials of the exported GLB `glb`, each texture with its status. */
export function modelMaterials(glb: string): Promise<MaterialReport[]> {
  return invoke<MaterialReport[]>('model_materials', { glb });
}
