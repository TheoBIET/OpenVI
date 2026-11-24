import { ChevronRight } from 'lucide-react';

import type { Entry } from '../lib/fs';
import { EntryIcon } from './EntryIcon';

type FolderTreeProps = {
  root: Entry;
  /** Loaded children (folders and archives) by folder path. */
  tree: Record<string, Entry[]>;
  expanded: ReadonlySet<string>;
  current: string;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
  onActivate: (entry: Entry) => void;
};

export function FolderTree(props: FolderTreeProps) {
  return (
    <aside className="w-64 shrink-0 overflow-auto border-r border-ink-800 bg-ink-900 py-1" aria-label="Folders">
      <TreeRow entry={props.root} depth={0} {...props} />
    </aside>
  );
}

function TreeRow({ entry, depth, ...props }: FolderTreeProps & { entry: Entry; depth: number }) {
  const isFolder = entry.kind === 'folder';
  const isOpen = isFolder && props.expanded.has(entry.path);
  const isCurrent = entry.path === props.current;
  const children = isOpen ? props.tree[entry.path] : undefined;

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={isCurrent}
        onClick={() => (isFolder ? props.onNavigate(entry.path) : props.onActivate(entry))}
        style={{ paddingLeft: depth * 14 + 4 }}
        className={`flex h-6 cursor-default items-center gap-1 pr-2 whitespace-nowrap ${
          isCurrent ? 'bg-flamingo/15 text-white' : 'hover:bg-ink-800/70'
        }`}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          onClick={(event) => {
            event.stopPropagation();
            if (isFolder) props.onToggle(entry.path);
          }}
          className={`grid size-4 shrink-0 place-items-center text-ink-400 ${isFolder ? '' : 'invisible'}`}
        >
          <ChevronRight className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </button>
        <EntryIcon entry={entry} open={isOpen} />
        <span className="truncate">{entry.name}</span>
      </div>
      {children?.map((child) => (
        <TreeRow key={child.path} {...props} entry={child} depth={depth + 1} />
      ))}
    </>
  );
}
