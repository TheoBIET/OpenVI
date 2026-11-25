import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AnimationsView } from './components/AnimationsView';
import { CharacterPreview } from './components/CharacterPreview';
import { CharactersView } from './components/CharactersView';
import { ClothesView, GarmentPreview } from './components/ClothesView';
import { DocumentView, isViewable } from './components/DocumentView';
import { EmptyState } from './components/EmptyState';
import { FileList } from './components/FileList';
import { FolderTree } from './components/FolderTree';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ScanPanel } from './components/ScanPanel';
import { type Section, SectionTabs } from './components/SectionTabs';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { VehiclePreview } from './components/VehiclePreview';
import { VehiclesView } from './components/VehiclesView';
import { WeaponPreview } from './components/WeaponPreview';
import { WeaponsView } from './components/WeaponsView';
import type { Vehicle } from './lib/catalog';
import type { Character } from './lib/characters';
import type { Garment } from './lib/clothes';
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
import type { Weapon } from './lib/weapons';

const lastFolderKey = 'openvi.lastGameFolder';

/** Path of the breadcrumb that stands for search results; it is not a place to navigate to. */
const searchCrumb = '#search';

/** Path of the breadcrumb that stands for an open document. */
const viewerCrumb = '#viewer';

/** Path of the breadcrumb that stands for the vehicle catalog. */
const vehiclesCrumb = '#vehicles';

/** Path of the breadcrumb that stands for the vehicle shown in 3D. */
const vehicleCrumb = '#vehicle';

/** Paths of the breadcrumbs that stand for the character list and the character shown in 3D. */
const charactersCrumb = '#characters';
const characterCrumb = '#character';

/** Paths of the breadcrumbs that stand for the weapon list and the weapon shown in 3D. */
const weaponsCrumb = '#weapons';
const weaponCrumb = '#weapon';

/** Paths of the breadcrumbs that stand for the clothes list and the garment shown in 3D. */
const clothesCrumb = '#clothes';
const garmentCrumb = '#garment';

/** Path of the breadcrumb that stands for the Animations section. */
const animationsCrumb = '#animations';

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
  /** A file or resource opened in place of the list. */
  const [viewer, setViewer] = useState<Entry | null>(null);
  /** The vehicle catalog, shown in place of the list. */
  const [section, setSection] = useState<Section>('explorer');
  const vehiclesOpen = section === 'vehicles';
  const setVehiclesOpen = (open: boolean) => setSection(open ? 'vehicles' : 'explorer');
  /** A vehicle of the catalog shown in 3D. */
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  /** A character of the Characters section shown in 3D. */
  const [character, setCharacter] = useState<Character | null>(null);
  /** A weapon of the Weapons section shown in 3D. */
  const [weapon, setWeapon] = useState<Weapon | null>(null);
  /** A garment of the Clothes section shown in 3D. */
  const [garment, setGarment] = useState<Garment | null>(null);
  /** In a catalog section rather than the explorer. */
  const inCatalog = section !== 'explorer';
  /** Only the latest navigation may show its listing: an archive scan can finish after the user moved on. */
  const latest = useRef(0);
  /** The archive being opened, for the progress listener (which outlives renders). */
  const openingRef = useRef<string | null>(null);

  /** Lists a folder or an archive; null when it failed or a later navigation superseded it. */
  async function load(rootPath: string, path: string): Promise<Listing | null> {
    const ticket = ++latest.current;
    const archive = isArchivePath(path);
    openingRef.current = archive ? path : null;
    setOpening(openingRef.current);
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
      if (ticket === latest.current) {
        openingRef.current = null;
        setOpening(null);
      }
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
    setViewer(null);
    setVehiclesOpen(false);
    setVehicle(null);
    setCharacter(null);
    setWeapon(null);
    setGarment(null);
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
    if (path === vehiclesCrumb) setVehicle(null);
    if (path === charactersCrumb) setCharacter(null);
    if (path === weaponsCrumb) setWeapon(null);
    if (path === clothesCrumb) setGarment(null);
    if (
      !root ||
      path === searchCrumb ||
      path === viewerCrumb ||
      path === vehiclesCrumb ||
      path === vehicleCrumb ||
      path === charactersCrumb ||
      path === characterCrumb ||
      path === weaponsCrumb ||
      path === weaponCrumb ||
      path === clothesCrumb ||
      path === garmentCrumb ||
      path === animationsCrumb
    )
      return;
    if (path === listing?.path && !search) {
      setViewer(null);
      setVehiclesOpen(false);
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
    // Back from an open document returns to the list it was opened from.
    if (viewer && step === -1) {
      setViewer(null);
      return;
    }
    if (vehicle && step === -1) {
      setVehicle(null);
      return;
    }
    if (character && step === -1) {
      setCharacter(null);
      return;
    }
    if (weapon && step === -1) {
      setWeapon(null);
      return;
    }
    if (garment && step === -1) {
      setGarment(null);
      return;
    }
    if (inCatalog && step === -1) {
      setVehiclesOpen(false);
      return;
    }
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
      setViewer(null);
      setVehiclesOpen(false);
      setVehicle(null);
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
    } else if (isViewable(entry)) {
      setSelected(entry.path);
      setViewer(entry);
    } else if (entry.kind === 'resource') {
      // The properties panel shows the selected resource.
      setSelected(entry.path);
    }
  }

  // Monaco and three.js are split out and loaded on first use; fetch them once the app has settled, so the first
  // document or model opens without waiting for them.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./lib/monaco');
      void import('./lib/scene');
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // Reopen the folder from the last session; the backend refuses it if it is gone.
  useEffect(() => {
    const last = localStorage.getItem(lastFolderKey);
    if (last) void openGameFolder(last);
  }, []);

  useEffect(() => {
    // A scan cannot be stopped: one left behind by a newer navigation keeps reporting, and only the archive
    // being opened may drive the scan panel.
    const archive = onArchiveProgress((step) => {
      if (step.archive === openingRef.current) setProgress(step);
    });
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
  const listCrumbs: Crumb[] =
    search && rootCrumb
      ? [rootCrumb, { name: `Search “${search.query}”`, path: searchCrumb }]
      : (listing?.crumbs ?? []);
  let crumbs = viewer ? [...listCrumbs, { name: viewer.name, path: viewerCrumb }] : listCrumbs;
  if (vehiclesOpen && rootCrumb) crumbs = [rootCrumb, { name: 'Vehicles', path: vehiclesCrumb }];
  if (vehiclesOpen && rootCrumb && vehicle) {
    crumbs = [...crumbs, { name: vehicle.displayName ?? vehicle.model ?? vehicle.modelHash, path: vehicleCrumb }];
  }
  if (section === 'animations' && rootCrumb) crumbs = [rootCrumb, { name: 'Animations', path: animationsCrumb }];
  if (section === 'characters' && rootCrumb) {
    crumbs = [rootCrumb, { name: 'Characters', path: charactersCrumb }];
    if (character) crumbs = [...crumbs, { name: character.name, path: characterCrumb }];
  }
  if (section === 'clothes' && rootCrumb) {
    crumbs = [rootCrumb, { name: 'Clothes', path: clothesCrumb }];
    if (garment) crumbs = [...crumbs, { name: garment.label, path: garmentCrumb }];
  }
  if (section === 'weapons' && rootCrumb) {
    crumbs = [rootCrumb, { name: 'Weapons', path: weaponsCrumb }];
    if (weapon) crumbs = [...crumbs, { name: weapon.name, path: weaponCrumb }];
  }
  const goUp = () => {
    if (viewer) setViewer(null);
    else if (vehicle && vehiclesOpen) setVehicle(null);
    else if (character && section === 'characters') setCharacter(null);
    else if (weapon && section === 'weapons') setWeapon(null);
    else if (garment && section === 'clothes') setGarment(null);
    else if (inCatalog) setVehiclesOpen(false);
    else if (search) void travel(-1);
    else if (parent) void navigate(parent.path);
  };
  let indexText: string | null = null;
  if (indexing) indexText = describeIndexing(indexing);
  else if (status) {
    indexText = `${status.archives.toLocaleString('en-US')} archives indexed · ${status.named.toLocaleString('en-US')} names`;
  }

  let indexLabel: string | null = null;
  if (root) indexLabel = indexing ? `Indexing ${indexing.position}/${indexing.count}` : 'Index';

  return (
    <div className="flex h-full flex-col">
      <div className="h-0.5 shrink-0 bg-accent-gradient" />
      <Toolbar
        crumbs={crumbs}
        filter={filter}
        canBack={inCatalog || viewer !== null || search !== null || history.index > 0}
        canForward={history.index < history.stack.length - 1}
        canUp={inCatalog || viewer !== null || parent !== undefined}
        onBack={() => void travel(-1)}
        onForward={() => void travel(1)}
        onUp={goUp}
        onNavigate={(path) => void navigate(path)}
        onFilter={setFilter}
        onSearch={(query) => void runSearch(query)}
        onOpenFolder={() => void chooseGameFolder()}
        indexLabel={indexLabel}
        indexing={indexing !== null}
        onIndex={() => void runIndex()}
      />
      {root && (
        <SectionTabs
          current={section}
          onSelect={(next) => {
            setViewer(null);
            setSection(next);
          }}
        />
      )}
      {root && listing && rootCrumb ? (
        <div className="flex min-h-0 flex-1">
          {/* The folder tree belongs to the explorer; the catalogs take the whole width. */}
          {section === 'explorer' && (
            <FolderTree
              root={{ name: rootCrumb.name, path: rootCrumb.path, kind: 'folder', size: 0, items: null }}
              tree={tree}
              expanded={expanded}
              current={opening ?? (search ? searchCrumb : listing.path)}
              onToggle={(path) => void toggleFolder(path)}
              onNavigate={(path) => void navigate(path)}
              onActivate={activate}
            />
          )}
          {opening && (
            <ScanPanel
              name={opening.split(/[\\/]/).at(-1) ?? opening}
              progress={progress?.archive === opening ? progress : null}
            />
          )}
          {!opening && viewer && <DocumentView root={root} entry={viewer} />}
          {!opening && !viewer && vehiclesOpen && !vehicle && (
            <VehiclesView root={root} filter={filter} onOpen={setVehicle} />
          )}
          {!opening && !viewer && vehiclesOpen && vehicle && (
            <VehiclePreview
              root={root}
              vehicle={vehicle}
              onFind={(model) => {
                setFilter(model);
                void runSearch(model);
              }}
            />
          )}
          {!opening && !viewer && section === 'characters' && !character && (
            <CharactersView root={root} filter={filter} onOpen={setCharacter} />
          )}
          {!opening && !viewer && section === 'characters' && character && (
            <CharacterPreview root={root} character={character} />
          )}
          {!opening && !viewer && section === 'clothes' && !garment && (
            <ClothesView root={root} filter={filter} onOpen={setGarment} />
          )}
          {!opening && !viewer && section === 'clothes' && garment && <GarmentPreview root={root} garment={garment} />}
          {!opening && !viewer && section === 'weapons' && !weapon && (
            <WeaponsView root={root} filter={filter} onOpen={setWeapon} />
          )}
          {!opening && !viewer && section === 'weapons' && weapon && <WeaponPreview root={root} weapon={weapon} />}
          {!opening && !viewer && section === 'animations' && <AnimationsView root={root} filter={filter} />}
          {!opening && !viewer && !inCatalog && (
            <FileList entries={visible} selected={selected} onSelect={setSelected} onActivate={activate} onUp={goUp} />
          )}
          {!opening && !viewer && !inCatalog && selectedEntry && (
            <PropertiesPanel
              root={root}
              entry={selectedEntry}
              onOpen={(entry) => {
                // The pane's Open shows the item itself, a search result included; folders and archives open as lists.
                if (isViewable(entry)) {
                  setSelected(entry.path);
                  setViewer(entry);
                } else {
                  activate(entry);
                }
              }}
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
        index={indexText}
        folderName={rootCrumb?.name}
      />
    </div>
  );
}
