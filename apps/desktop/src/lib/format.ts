import type { Entry } from './fs';

const sizeUnits = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < sizeUnits.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${sizeUnits[unit]}`;
}

/** An offset in an archive, as the "Offset" column shows it. */
export function formatOffset(offset: number): string {
  return `0x${offset.toString(16).toUpperCase().padStart(9, '0')}`;
}

const typeByExtension: Record<string, string> = {
  rpf: 'Rage Package File',
  ttpf: 'Texture store',
  bk2: 'Bink video',
  bin: 'Binary data',
  exe: 'Application',
  dll: 'Application extension',
  xml: 'XML document',
  json: 'JSON document',
  txt: 'Text document',
  ini: 'Configuration settings',
  config: 'Configuration',
};

export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

/** Explorer "Type" column, also used to group the list. */
export function typeLabel(entry: Entry): string {
  if (entry.typeName) return entry.typeName;
  if (entry.kind === 'folder') return 'Folder';
  const extension = extensionOf(entry.name);
  if (!extension) return 'File';
  return typeByExtension[extension] ?? `${extension.toUpperCase()} file`;
}
