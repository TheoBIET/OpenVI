import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from './components/EmptyState';
import { FileList } from './components/FileList';
import { FolderTree } from './components/FolderTree';
import { ScanPanel } from './components/ScanPanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import {
  type Entry,
  isArchivePath,
  isTreeEntry,
  type Listing,
  listDir,
  listPath,
  onArchiveProgress,
  type ScanProgress,
} from './lib/fs';

const lastFolderKey = 'openvi.lastGameFolder';

type History = { stack: string[]; index: number };

export function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [history, setHistory] = useState<History>({ stack: [], index: -1 });
  const [tree, setTree] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The archive being opened, while its listing is on its way. */
  const [opening, setOpening] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  /** Only the latest navigation may show its listing: an archive scan can finish after the user moved on. */
  const latest = useRef(0);

  /** Lists a folder or an archive; null when it failed or a later navigation superseded it. */
  async function load(rootPath: string, path: string): Promise<Listing | null> {
    const ticket = ++latest.current;
    const archive = isArchivePath(path);
    setOpening(archive ? path : null);
    setProgress(null);
    try {
      const next = await listPath(rootPath, path);
      return ticket === latest.current ? next : null;
    } catch (failure) {
      if (ticket === latest.current) setError(String(failure));
      return null;
    } finally {
      if (ticket === latest.current) setOpening(null);
    }
  }

  /** Shows `next` in the list and opens its ancestors in the tree. */
  function show(next: Listing) {
    setListing(next);
    setTree((previous) => ({ ...previous, [next.path]: next.entries.filter(isTreeEntry) }));
    setExpanded((previous) => new Set([...previous, ...next.crumbs.map((crumb) => crumb.path)]));
    setSelected(null);
    setFilter('');
    setNotice(null);
    setError(null);
  }

  async function openGameFolder(path: string) {
    const next = await load(path, path);
    if (!next) {
      localStorage.removeItem(lastFolderKey);
      return;
    }
    localStorage.setItem(lastFolderKey, next.path);
    setRoot(next.path);
    setTree({});
    setExpanded(new Set());
    show(next);
    setHistory({ stack: [next.path], index: 0 });
  }

  async function chooseGameFolder() {
    const path = await open({ directory: true, title: 'Open GTA VI folder' });
    if (typeof path === 'string') await openGameFolder(path);
  }

  async function navigate(path: string) {
    if (!root || path === listing?.path) return;
    const next = await load(root, path);
    if (!next) return;
    show(next);
    setHistory((previous) => {
      const stack = [...previous.stack.slice(0, previous.index + 1), next.path];
      return { stack, index: stack.length - 1 };
    });
  }

  async function travel(step: -1 | 1) {
    const index = history.index + step;
    const path = history.stack[index];
    if (!root || path === undefined) return;
    const next = await load(root, path);
    if (!next) return;
    show(next);
    setHistory((previous) => ({ ...previous, index }));
  }

  async function toggleFolder(path: string) {
    if (!root) return;
    if (expanded.has(path)) {
      setExpanded((previous) => new Set([...previous].filter((open) => open !== path)));
      return;
    }
    if (!tree[path]) {
      // Only folders expand in the tree, and expanding one must not cancel a navigation under way.
      let next: Listing;
      try {
        next = await listDir(root, path);
      } catch (failure) {
        setError(String(failure));
        return;
      }
      setTree((previous) => ({ ...previous, [path]: next.entries.filter(isTreeEntry) }));
    }
    setExpanded((previous) => new Set(previous).add(path));
  }

  function activate(entry: Entry) {
    if (entry.kind === 'folder' || entry.kind === 'archive') {
      void navigate(entry.path);
    } else if (entry.kind === 'resource') {
      setSelected(entry.path);
      setNotice(`Previews are not available yet: ${entry.name} will open once the viewers ship.`);
    }
  }

  // Reopen the folder from the last session; the backend refuses it if it is gone.
  useEffect(() => {
    const last = localStorage.getItem(lastFolderKey);
    if (last) void openGameFolder(last);
  }, []);

  useEffect(() => {
    const unlisten = onArchiveProgress(setProgress);
    return () => void unlisten.then((stop) => stop());
  }, []);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const entries = listing?.entries ?? [];
    return needle ? entries.filter((entry) => entry.name.toLowerCase().includes(needle)) : entries;
  }, [listing, filter]);

  const rootCrumb = listing?.crumbs[0];
  const parent = listing?.crumbs.at(-2);
  const selectedEntry = listing?.entries.find((entry) => entry.path === selected);

  return (
    <div className="flex h-full flex-col">
      <div className="h-0.5 shrink-0 bg-linear-to-r from-flamingo via-sunset to-gold" />
      <Toolbar
        crumbs={listing?.crumbs ?? []}
        filter={filter}
        canBack={history.index > 0}
        canForward={history.index < history.stack.length - 1}
        canUp={parent !== undefined}
        onBack={() => void travel(-1)}
        onForward={() => void travel(1)}
        onUp={() => parent && void navigate(parent.path)}
        onNavigate={(path) => void navigate(path)}
        onFilter={setFilter}
        onOpenFolder={() => void chooseGameFolder()}
      />
      {root && listing && rootCrumb ? (
        <div className="flex min-h-0 flex-1">
          <FolderTree
            root={{ name: rootCrumb.name, path: rootCrumb.path, kind: 'folder', size: 0, items: null }}
            tree={tree}
            expanded={expanded}
            current={listing.path}
            onToggle={(path) => void toggleFolder(path)}
            onNavigate={(path) => void navigate(path)}
            onActivate={activate}
          />
          {opening ? (
            <ScanPanel
              name={opening.split(/[\\/]/).at(-1) ?? opening}
              progress={progress?.archive === opening ? progress : null}
            />
          ) : (
            <FileList
              entries={visible}
              selected={selected}
              onSelect={setSelected}
              onActivate={activate}
              onUp={() => parent && void navigate(parent.path)}
            />
          )}
        </div>
      ) : (
        <EmptyState error={error} onOpen={() => void chooseGameFolder()} />
      )}
      <StatusBar
        shown={visible.length}
        selected={selectedEntry}
        notice={notice ?? (listing ? error : null)}
        folderName={rootCrumb?.name}
      />
    </div>
  );
}
