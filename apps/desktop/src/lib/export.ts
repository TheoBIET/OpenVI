import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

/** Asks where to save the resource at `path` (`<archive>#<offset>`) and writes it there, inflated. */
export async function saveResource(root: string, path: string, suggestedName: string): Promise<string | null> {
  const dest = await save({ title: 'Save resource', defaultPath: suggestedName });
  if (!dest) return null;
  await invoke('save_resource', { root, path, dest });
  return dest;
}

/** Asks where to save texture `texture` of the resource at `path` and writes it as a full-size PNG. */
export async function saveTexture(root: string, path: string, texture: number, name: string): Promise<string | null> {
  const dest = await save({
    title: 'Save texture',
    defaultPath: `${name || `texture_${texture}`}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (!dest) return null;
  await invoke('save_texture', { root, path, texture, dest });
  return dest;
}

/** Asks for a folder and copies the model export (GLB and textures) `glb` into it; returns where it went. */
export async function saveModel(glb: string): Promise<string | null> {
  const dest = await open({ title: 'Export model to folder', directory: true });
  if (typeof dest !== 'string') return null;
  return invoke<string>('save_model', { glb, dest });
}
