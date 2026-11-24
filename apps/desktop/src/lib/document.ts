import { invoke } from '@tauri-apps/api/core';

/** How the document view shows a loose file. */
export type FilePreview =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'image'; mime: string }
  | { kind: 'binary' };

/** What the file at `path` (inside `root`) holds; the text, for a text file. */
export function filePreview(root: string, path: string): Promise<FilePreview> {
  return invoke<FilePreview>('file_preview', { root, path });
}

async function objectUrl(command: string, args: Record<string, string>, mime: string): Promise<string> {
  const bytes = await invoke<ArrayBuffer>(command, args);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** The image file at `path`, as an object URL; revoke it when done. */
export function fileImage(root: string, path: string, mime: string): Promise<string> {
  return objectUrl('file_bytes', { root, path }, mime);
}

/** The PNG image resource at `path` (`<archive>#<offset>`), as an object URL; revoke it when done. */
export function resourceImage(root: string, path: string): Promise<string> {
  return objectUrl('resource_image', { root, path }, 'image/png');
}
