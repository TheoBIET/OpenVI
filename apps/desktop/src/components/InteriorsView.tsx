import { DoorOpen, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Interior, mapInfo } from '../lib/map';
import { LoadingPanel } from './LoadingPanel';
import { listKeys, PreviewPane, PreviewSection, Properties } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; interiors: Interior[] } | { state: 'failed'; error: string };

const grid = { gridTemplateColumns: 'minmax(12rem,1fr) 4rem 5rem 4rem 14rem' };

/** A row's id: its name and where it stands (the same interior is placed several times). */
const idOf = (interior: Interior) => `${interior.name}@${interior.position.join(',')}`;

/** Every interior the map places (shops, homes, garages…), filtered by name; one is shown on the map on demand. */
export function InteriorsView({
  root,
  filter,
  onShow,
}: {
  root: string;
  filter: string;
  onShow: (interior: Interior) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [selected, setSelected] = useState<Interior | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    mapInfo(root).then(
      (info) => current && setLoaded({ state: 'ready', interiors: info.interiors }),
      (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  const rows = useMemo(() => {
    if (loaded.state !== 'ready') return [];
    const needle = filter.trim().toLowerCase();
    const shown = needle ? loaded.interiors.filter((interior) => interior.name.includes(needle)) : loaded.interiors;
    return [...shown].sort((a, b) => a.name.localeCompare(b.name));
  }, [loaded, filter]);

  if (loaded.state === 'loading') {
    return (
      <LoadingPanel
        icon={DoorOpen}
        title="Finding the interiors"
        note="The first time reads every map file of levels.rpf (a few minutes), with the Map; then it is cached."
        step={progress}
      />
    );
  }
  if (loaded.state === 'failed') {
    return (
      <p className="grid min-w-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">
        {loaded.error}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-1">
      <main aria-label="Interiors" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Interiors</span>
          <span className="font-mono tabular-nums">
            {rows.length === loaded.interiors.length
              ? loaded.interiors.length.toLocaleString('en-US')
              : `${rows.length.toLocaleString('en-US')} of ${loaded.interiors.length.toLocaleString('en-US')}`}{' '}
            placed
          </span>
        </div>
        <div
          className="grid h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground"
          style={grid}
        >
          <span>Name</span>
          <span className="text-right">Rooms</span>
          <span className="text-right">Entities</span>
          <span className="text-right">Sets</span>
          <span className="text-right">Position</span>
        </div>
        <div
          tabIndex={0}
          aria-label="Interiors list"
          onKeyDown={listKeys(rows, idOf, selected, setSelected, onShow)}
          className="flex-1 overflow-auto outline-none"
        >
          {rows.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">No interior matches.</p>}
          {rows.map((interior) => (
            <div
              key={idOf(interior)}
              role="row"
              data-row={idOf(interior)}
              title="Double-click to see it on the map"
              onClick={() => setSelected(interior)}
              onDoubleClick={() => onShow(interior)}
              className={`grid h-6 cursor-default items-center gap-3 px-3 ${
                selected && idOf(selected) === idOf(interior) ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
              style={grid}
            >
              <span className="truncate font-mono text-xs">{interior.name}</span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {interior.defined ? interior.rooms : ''}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {interior.defined ? interior.entities : ''}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {interior.defined ? interior.sets : ''}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {interior.position.map((value) => value.toFixed(0)).join(', ')}
              </span>
            </div>
          ))}
        </div>
      </main>
      {selected && (
        <PreviewPane title={selected.name} subtitle="Interior" onOpen={() => onShow(selected)}>
          <PreviewSection>
            <Properties
              rows={[
                ['Name', selected.name],
                ['Position', selected.position.map((value) => value.toFixed(1)).join(', ')],
                ['Rooms', selected.defined ? selected.rooms : '—'],
                ['Entities', selected.defined ? selected.entities : '—'],
                ['Entity sets', selected.defined ? selected.sets : '—'],
              ]}
            />
            {!selected.defined && (
              <p className="mt-2 text-muted-foreground">Its definition was not found in the map files read.</p>
            )}
            <button
              type="button"
              onClick={() => onShow(selected)}
              className="mt-2 inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-foreground hover:bg-muted"
            >
              <MapPin className="size-3.5" />
              Show on the map
            </button>
          </PreviewSection>
        </PreviewPane>
      )}
    </div>
  );
}
