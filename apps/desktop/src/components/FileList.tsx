import { type KeyboardEvent, useMemo } from 'react';

import { formatSize, typeLabel } from '../lib/format';
import type { Entry } from '../lib/fs';
import { EntryIcon } from './EntryIcon';

type FileListProps = {
  entries: Entry[];
  selected: string | null;
  onSelect: (path: string) => void;
  onActivate: (entry: Entry) => void;
  onUp: () => void;
};

type Group = { label: string; entries: Entry[] };

const columns = 'grid grid-cols-[minmax(0,1fr)_11rem_7rem] items-center gap-4';

/** Folders first, archives next, then the other types alphabetically, as in the backend's sort. */
function groupByType(entries: Entry[]): Group[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const label = typeLabel(entry);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  const leading = ['Folder', 'Rage Package File'];
  const rank = (group: Group) => {
    const index = leading.indexOf(group.label);
    return index === -1 ? leading.length : index;
  };
  return [...groups]
    .map(([label, items]) => ({ label, entries: items }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

export function FileList({ entries, selected, onSelect, onActivate, onUp }: FileListProps) {
  const groups = useMemo(() => groupByType(entries), [entries]);
  const ordered = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = ordered.findIndex((entry) => entry.path === selected);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = ordered[Math.min(Math.max(index + step, 0), ordered.length - 1)];
      if (next) onSelect(next.path);
    } else if (event.key === 'Enter') {
      const entry = ordered[index];
      if (entry) onActivate(entry);
    } else if (event.key === 'Backspace') {
      onUp();
    }
  }

  return (
    <section
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Items"
      className="flex min-w-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <div className={`${columns} h-7 shrink-0 border-b border-ink-800 bg-ink-900 px-3 text-xs text-ink-400`}>
        <span>Name</span>
        <span>Type</span>
        <span className="text-right">Size</span>
      </div>
      <div className="flex-1 overflow-auto pb-2">
        {groups.length === 0 && <p className="px-3 py-6 text-center text-ink-400">No items match.</p>}
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <div className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-medium text-flamingo">
              {group.label}
              <span className="text-ink-400">({group.entries.length})</span>
              <span className="h-px flex-1 bg-ink-800" />
            </div>
            {group.entries.map((entry) => (
              <div
                key={entry.path}
                role="row"
                aria-selected={entry.path === selected}
                onClick={() => onSelect(entry.path)}
                onDoubleClick={() => onActivate(entry)}
                className={`${columns} h-6 cursor-default px-3 ${
                  entry.path === selected
                    ? 'bg-flamingo/15 text-white shadow-[inset_2px_0_0_var(--color-flamingo)]'
                    : 'hover:bg-ink-800/60'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <EntryIcon entry={entry} />
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="truncate text-ink-400">{typeLabel(entry)}</span>
                <span className="text-right font-mono text-xs text-ink-400 tabular-nums">
                  {entry.kind === 'folder' ? `${entry.items ?? '?'} items` : formatSize(entry.size)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
