import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { formatOffset, formatSize, typeLabel } from '../lib/format';
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

/** One line of the list: a group header or an entry, at a fixed height so only the visible lines are rendered. */
type Line = { top: number; header: Group; entry?: undefined } | { top: number; entry: Entry; header?: undefined };

/** The column after Size: offsets in an archive, the archive in search results. */
type Extra = 'offset' | 'archive' | null;

const extraColumns = {
  none: 'grid-cols-[minmax(0,1fr)_11rem_7rem]',
  offset: 'grid-cols-[minmax(0,1fr)_11rem_7rem_7rem]',
  archive: 'grid-cols-[minmax(0,1fr)_11rem_7rem_minmax(0,16rem)]',
};

/** Search results show where each resource lives; an archive listing shows offsets. */
function extraOf(entries: Entry[]): Extra {
  if (entries.some((entry) => entry.location !== undefined)) return 'archive';
  if (entries.some((entry) => entry.offset !== undefined)) return 'offset';
  return null;
}

const headerHeight = 32;
const rowHeight = 24;
/** Lines rendered above and below the viewport, so fast scrolling does not show blanks. */
const overscan = 400;

/** Folders first, archives next, then the other types alphabetically, as in the backend's sort. */
function groupByType(entries: Entry[]): Group[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const label = typeLabel(entry);
    const group = groups.get(label);
    if (group) group.push(entry);
    else groups.set(label, [entry]);
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

function layOut(groups: Group[]): { lines: Line[]; height: number } {
  const lines: Line[] = [];
  let top = 0;
  for (const group of groups) {
    lines.push({ top, header: group });
    top += headerHeight;
    for (const entry of group.entries) {
      lines.push({ top, entry });
      top += rowHeight;
    }
  }
  return { lines, height: top };
}

/** Index of the last line starting at or above `y`. */
function lineAt(lines: Line[], y: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lines[middle]?.top ?? 0) <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function FileList({ entries, selected, onSelect, onActivate, onUp }: FileListProps) {
  const groups = useMemo(() => groupByType(entries), [entries]);
  const ordered = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const { lines, height } = useMemo(() => layOut(groups), [groups]);
  const extra = extraOf(entries);
  const columns = `grid ${extraColumns[extra ?? 'none']} items-center gap-4`;

  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // A new listing or filter starts at the top, or at the selection when one was given with it.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const line = selected ? lines.find((candidate) => candidate.entry?.path === selected) : undefined;
    element.scrollTop = line ? Math.max(line.top - element.clientHeight / 2, 0) : 0;
  }, [entries]);

  function reveal(path: string) {
    const element = scroller.current;
    const line = lines.find((candidate) => candidate.entry?.path === path);
    if (!element || !line) return;
    if (line.top < element.scrollTop) element.scrollTop = line.top;
    else if (line.top + rowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = line.top + rowHeight - element.clientHeight;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = ordered.findIndex((entry) => entry.path === selected);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = ordered[Math.min(Math.max(index + step, 0), ordered.length - 1)];
      if (next) {
        onSelect(next.path);
        reveal(next.path);
      }
    } else if (event.key === 'Enter') {
      const entry = ordered[index];
      if (entry) onActivate(entry);
    } else if (event.key === 'Backspace') {
      onUp();
    }
  }

  const first = lines.length ? lineAt(lines, viewport.top - overscan) : 0;
  const last = lines.length ? lineAt(lines, viewport.top + viewport.height + overscan) : -1;
  const visible = lines.slice(first, last + 1);

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
        {extra === 'offset' && <span className="text-right">Offset</span>}
        {extra === 'archive' && <span>Archive</span>}
      </div>
      <div
        ref={scroller}
        onScroll={(event) =>
          setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
        }
        className="flex-1 overflow-auto"
      >
        {groups.length === 0 && <p className="px-3 py-6 text-center text-ink-400">No items match.</p>}
        <div className="relative" style={{ height: height + 8 }}>
          {visible.map((line) =>
            line.header ? (
              <div
                key={`group:${line.header.label}`}
                role="group"
                aria-label={line.header.label}
                style={{ top: line.top, height: headerHeight }}
                className="absolute inset-x-0 flex items-end gap-2 px-3 pb-1 text-xs font-medium text-flamingo"
              >
                {line.header.label}
                <span className="text-ink-400">({line.header.entries.length.toLocaleString('en-US')})</span>
                <span className="mb-1.5 h-px flex-1 bg-ink-800" />
              </div>
            ) : (
              <Row
                key={line.entry.path}
                entry={line.entry}
                top={line.top}
                columns={columns}
                extra={extra}
                selected={line.entry.path === selected}
                onSelect={onSelect}
                onActivate={onActivate}
              />
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function Row({
  entry,
  top,
  columns,
  extra,
  selected,
  onSelect,
  onActivate,
}: {
  entry: Entry;
  top: number;
  columns: string;
  extra: Extra;
  selected: boolean;
  onSelect: (path: string) => void;
  onActivate: (entry: Entry) => void;
}) {
  // Resources the data does not name go by their offset; dimmed so named ones stand out.
  const unnamed = entry.kind === 'resource' && entry.name.startsWith('0x');
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={() => onSelect(entry.path)}
      onDoubleClick={() => onActivate(entry)}
      style={{ top, height: rowHeight }}
      className={`${columns} absolute inset-x-0 cursor-default px-3 ${
        selected ? 'bg-flamingo/15 text-white shadow-[inset_2px_0_0_var(--color-flamingo)]' : 'hover:bg-ink-800/60'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <EntryIcon entry={entry} />
        <span className={`truncate ${unnamed ? 'font-mono text-xs text-ink-400' : ''}`}>{entry.name}</span>
      </span>
      <span className="truncate text-ink-400">{typeLabel(entry)}</span>
      <span className="text-right font-mono text-xs text-ink-400 tabular-nums">
        {entry.kind === 'folder' ? `${entry.items ?? '?'} items` : formatSize(entry.size)}
      </span>
      {extra === 'offset' && (
        <span className="text-right font-mono text-xs text-ink-400 tabular-nums">
          {entry.offset === undefined ? '' : formatOffset(entry.offset)}
        </span>
      )}
      {extra === 'archive' && <span className="truncate text-ink-400">{entry.location}</span>}
    </div>
  );
}
