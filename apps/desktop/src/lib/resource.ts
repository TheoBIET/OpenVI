import { invoke } from '@tauri-apps/api/core';

export type TextureInfo = {
  /** Position among the resource's textures: the handle {@link texturePreview} takes. */
  index: number;
  name: string;
  width: number;
  height: number;
  mips: number;
  /** DXGI format name, such as `BC7_UNORM`. */
  format: string;
};

export type ResourceDetails = {
  offset: number;
  compressedSize: number;
  size: number;
  kind: string;
  subType: string;
  extension: string;
  name: string | null;
  resourceType: string | null;
  typeName: string;
  /** Zlib streams the resource spans. */
  streams: number;
  textures: TextureInfo[];
};

/** Details of the resource at `path` (`<archive>#<offset>`). */
export function resourceInfo(root: string, path: string): Promise<ResourceDetails> {
  return invoke<ResourceDetails>('resource_info', { root, path });
}

/** Texture `texture` of the resource at `path`, as an object URL of a PNG; revoke it when done. */
export async function texturePreview(root: string, path: string, texture: number): Promise<string> {
  const bytes = await invoke<ArrayBuffer>('texture_preview', { root, path, texture });
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
}

/** The start of a text resource; `truncated` when it goes on past what the viewer shows. */
export type TextPreview = { text: string; truncated: boolean };

/** The text of the XML or plain-text resource at `path`. */
export function textPreview(root: string, path: string): Promise<TextPreview> {
  return invoke<TextPreview>('resource_text_preview', { root, path });
}
