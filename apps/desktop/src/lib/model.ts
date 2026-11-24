import { invoke } from '@tauri-apps/api/core';

/** The GLB file of the model resource at `path` (`<archive>#<offset>`), exported on first use. */
export function modelPreview(root: string, path: string): Promise<string> {
  return invoke<string>('model_preview', { root, path });
}

/** The GLB file of vehicle `name` in configuration `config`, wheels fitted (scans levels.rpf first if needed). */
export function vehiclePreview(root: string, name: string, config: number): Promise<string> {
  return invoke<string>('vehicle_preview', { root, name, config });
}
