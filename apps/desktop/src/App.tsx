import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from './components/EmptyState';
import { FileList } from './components/FileList';
import { FolderTree } from './components/FolderTree';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ScanPanel } from './components/ScanPanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import {
  type Crumb,
  type Entry,
  isArchivePath,
  isTreeEntry,
  type Listing,
  listDir,
  listPath,
  onArchiveProgress,
  type ScanProgress,
} from './lib/fs';
import {
  archiveOf,
  indexGame,
  type IndexProgress,
  type IndexStatus,
  indexStatus,
  onIndexProgress,
  searchIndex,
} from './lib/index';

const lastFolderKey = 'openvi.lastGameFolder';

/** Path of the breadcrumb that stands for search results; it is not a place to navigate to. */
const searchCrumb = '#search';

type History = { stack: string[]; index: number };

type Search = { query: string; entries: Entry[]; truncated: boolean };

function percent(done: number, total: number): string {
  return `${Math.round((done * 100) / Math.max(total, 1))}%`;
}

function describeIndexing(step: IndexProgress): string {
  if (step.count === 0) return 'Indexing: listing archives…';
  const where = `Indexing ${step.archive} (${step.position}/${step.count})`;
  if (step.phase === 'carving') return `${where} · finding resources ${percent(step.done, step.total)}`;
  if (step.phase === 'naming') return `${where} · reading names ${percent(step.done, step.total)}`;
  return where;
}

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
  /** Search results replace the listing until the user navigates. */
  const [search, setSearch] = useState<Search | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  /** Non-null while an indexing pass runs. */
  const [indexing, setIndexing] = useState<IndexProgress | null>(null);
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
      // Opening an archive also stores it in the index.
      if (archive) void refreshStatus(rootPath);
      return ticket === latest.current ? next : null;
    } catch (failure) {
      if (ticket === latest.current) setError(String(failure));
      return null;
    } finally {
      if (ticket === latest.current) setOpening(null);
    }
  }

  async function refreshStatus(rootPath: string) {
    try {
      setStatus(await indexStatus(rootPath));
    } catch {
      setStatus(null);
    }
  }

  /** Shows `next` in the list, with `select` selected, and opens its ancestors in the tree. */
  function show(next: Listing, select: string | null = null) {
    setListing(next);
    setSearch(null);
    setTree((previous) => ({ ...previous, [next.path]: next.entries.filter(isTreeEntry) }));
    setExpanded((previous) => new Set([...previous, ...next.crumbs.map((crumb) => crumb.path)]));
    setSelected(select);
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
    void refreshStatus(next.path);
  }

  async function chooseGameFolder() {
    const path = await open({ directory: true, title: 'Open GTA VI folder' });
    if (typeof path === 'string') await openGameFolder(path);
  }

  async function navigate(path: string, select: string | null = null) {
    if (!root || path === searchCrumb) return;
    if (path === listing?.path && !search) {
      if (select) setSelected(select);
      return;
    }
    const next = await load(root, path);
    if (!next) return;
    show(next, select);
    setHistory((previous) => {
      const stack = [...previous.stack.slice(0, previous.index + 1), next.path];
      return { stack, index: stack.length - 1 };
    });
  }

  async function travel(step: -1 | 1) {
    // Back from search results returns to the listing they replaced.
    if (search && step === -1) {
      setSearch(null);
      setFilter('');
      setSelected(null);
      setNotice(null);
      return;
    }
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

  async function runSearch(text: string) {
    const query = text.trim();
    if (!root || !query) return;
    try {
      const view = await searchIndex(root, query);
      setSearch({ query, ...view });
      setSelected(null);
      setError(null);
      if (view.truncated) {
        setNotice(`Showing the first ${view.entries.length.toLocaleString('en-US')} matches; refine the search.`);
      } else if (view.entries.length > 0) {
        setNotice(null);
      } else if (status?.archives) {
        setNotice(`No indexed resource has “${query}” in its name.`);
      } else {
        setNotice('The index is empty: click Index to scan every archive, or open archives one by one.');
      }
    } catch (failure) {
      setError(String(failure));
    }
  }

  async function runIndex() {
    if (!root || indexing) return;
    setIndexing({ archive: '', position: 0, count: 0, phase: null, done: 0, total: 0 });
    setNotice(null);
    try {
      const report = await indexGame(root);
      const parts = [
        `Index up to date: ${report.indexed} archive${report.indexed === 1 ? '' : 's'} scanned`,
        `${report.unchanged} unchanged`,
      ];
      if (report.failed.length > 0) parts.push(`${report.failed.length} failed (${report.failed[0]})`);
      setNotice(parts.join(', '));
    } catch (failure) {
      setError(String(failure));
    } finally {
      setIndexing(null);
      void refreshStatus(root);
    }
  }

  function activate(entry: Entry) {
    if (entry.kind === 'folder' || entry.kind === 'archive') {
      void navigate(entry.path);
    } else if (entry.location !== undefined) {
      // A search result opens its archive with the resource selected.
      void navigate(archiveOf(entry.path), entry.path);
    } else if (entry.kind === 'resource') {
      // The properties panel shows the selected resource.
      setSelected(entry.path);
    }
  }

  // Reopen the folder from the last session; the backend refuses it if it is gone.
  useEffect(() => {
    const last = localStorage.getItem(lastFolderKey);
    if (last) void openGameFolder(last);
  }, []);

  useEffect(() => {
    const archive = onArchiveProgress(setProgress);
    const index = onIndexProgress(setIndexing);
    return () => {
      void archive.then((stop) => stop());
      void index.then((stop) => stop());
    };
  }, []);

  const entries = search?.entries ?? listing?.entries;
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = entries ?? [];
    return needle ? all.filter((entry) => entry.name.toLowerCase().includes(needle)) : all;
  }, [entries, filter]);

  const rootCrumb = listing?.crumbs[0];
  const parent = search ? undefined : listing?.crumbs.at(-2);
  const selectedEntry = entries?.find((entry) => entry.path === selected);
  const crumbs: Crumb[] =
    search && rootCrumb
      ? [rootCrumb, { name: `Search “${search.query}”`, path: searchCrumb }]
      : (listing?.crumbs ?? []);
  let indexText: string | null = null;
  if (indexing) indexText = describeIndexing(indexing);
  else if (status) {
    indexText = `${status.archives.toLocaleString('en-US')} archives indexed · ${status.named.toLocaleString('en-US')} names`;
  }

  let indexLabel: string | null = null;
  if (root) indexLabel = indexing ? `Indexing ${indexing.position}/${indexing.count}` : 'Index';

  return (
    <div className="flex h-full flex-col">
      <div className="h-0.5 shrink-0 bg-linear-to-r from-flamingo via-sunset to-gold" />
      <Toolbar
        crumbs={crumbs}
        filter={filter}
        canBack={search !== null || history.index > 0}
        canForward={history.index < history.stack.length - 1}
        canUp={parent !== undefined}
        onBack={() => void travel(-1)}
        onForward={() => void travel(1)}
        onUp={() => parent && void navigate(parent.path)}
        onNavigate={(path) => void navigate(path)}
        onFilter={setFilter}
        onSearch={(query) => void runSearch(query)}
        onOpenFolder={() => void chooseGameFolder()}
        indexLabel={indexLabel}
        indexing={indexing !== null}
        onIndex={() => void runIndex()}
      />
      {root && listing && rootCrumb ? (
        <div className="flex min-h-0 flex-1">
          <FolderTree
            root={{ name: rootCrumb.name, path: rootCrumb.path, kind: 'folder', size: 0, items: null }}
            tree={tree}
            expanded={expanded}
            current={search ? searchCrumb : listing.path}
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
              onUp={() => (search ? void travel(-1) : parent && void navigate(parent.path))}
            />
          )}
          {!opening && selectedEntry?.kind === 'resource' && <PropertiesPanel root={root} entry={selectedEntry} />}
        </div>
      ) : (
        <EmptyState error={error} onOpen={() => void chooseGameFolder()} />
      )}
      <StatusBar
        shown={visible.length}
        selected={selectedEntry}
        notice={notice ?? (listing ? error : null)}
        index={indexText}
        folderName={rootCrumb?.name}
      />
    </div>
  );
}
