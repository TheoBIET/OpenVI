import {
  Binary,
  Box,
  Boxes,
  File,
  FileCode,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Image,
  Images,
  Package,
} from 'lucide-react';

import { extensionOf } from '../lib/format';
import type { Entry } from '../lib/fs';

const codeExtensions = new Set(['xml', 'json', 'ini', 'config', 'meta']);

const resourceIcons: Record<string, typeof File> = {
  Drawable: Box,
  Fragment: Box,
  'Drawable Dictionary': Boxes,
  'Texture Dictionary': Images,
  'DDS Texture': Image,
  'PNG Image': Image,
  'XML Document': FileCode,
  'Binary XML': FileCode,
  'PSO Metadata': FileCode,
  'Scaleform Movie': FileVideo,
  Text: FileText,
};

export function EntryIcon({ entry, open = false }: { entry: Entry; open?: boolean }) {
  const className = 'size-4 shrink-0';
  if (entry.kind === 'folder') {
    const Icon = open ? FolderOpen : Folder;
    return <Icon className={`${className} text-gold`} />;
  }
  if (entry.kind === 'archive') return <Package className={`${className} text-sunset`} />;
  if (entry.kind === 'resource') {
    const Icon = resourceIcons[entry.typeName ?? ''] ?? Binary;
    const tone = Icon === Box || Icon === Boxes ? 'text-lagoon' : 'text-ink-400';
    return <Icon className={`${className} ${tone}`} />;
  }
  const extension = extensionOf(entry.name) ?? '';
  if (codeExtensions.has(extension)) return <FileCode className={`${className} text-lagoon`} />;
  if (extension === 'txt') return <FileText className={`${className} text-ink-400`} />;
  if (extension === 'bk2') return <FileVideo className={`${className} text-ink-400`} />;
  if (extension === 'bin') return <Binary className={`${className} text-ink-400`} />;
  return <File className={`${className} text-ink-400`} />;
}
