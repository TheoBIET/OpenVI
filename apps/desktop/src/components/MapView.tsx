import { Crosshair, Map as MapIcon, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { at, type MapInfo, mapInfo, mapPoints } from '../lib/map';
import type { MapHandle, MapPoints } from '../lib/mapScene';
import { LoadingPanel } from './LoadingPanel';
import { PreviewPane, PreviewSection, Properties } from './preview';

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; info: MapInfo; points: MapPoints }
  | { state: 'failed'; error: string };

/**
 * The map from above, in the spirit of CodeWalker: every entity the map files place, coloured by height. The filter
 * box lights up the entities whose model matches; a click shows an entity, whose model can be found in the explorer.
 */
export function MapView({
  root,
  filter,
  onFind,
  focus,
}: {
  root: string;
  filter: string;
  onFind: (model: string) => void;
  /** A point to centre on when the map opens (from the Interiors section), metres. */
  focus: { x: number; y: number } | null;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const [showInteriors, setShowInteriors] = useState(true);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setLoaded({ state: 'loading' });
    mapInfo(root)
      .then((info) => Promise.all([info, mapPoints(root), import('../lib/mapScene')]))
      .then(
        ([info, buffer, scene]) => current && setLoaded({ state: 'ready', info, points: scene.readPoints(buffer) }),
        (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
      );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  useEffect(() => {
    if (loaded.state !== 'ready' || !host.current) return;
    let disposed = false;
    const element = host.current;
    void import('../lib/mapScene').then(({ mountMap }) => {
      if (disposed) return;
      const interiors = new Float32Array(
        loaded.info.interiors.flatMap((interior) => [interior.position[0], interior.position[1]]),
      );
      handle.current = mountMap(element, loaded.points, interiors, setPicked);
      if (focus) handle.current.focus(focus.x, focus.y, 400);
    });
    return () => {
      disposed = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [loaded]);

  // Models whose name contains the filter.
  const matching = useMemo(() => {
    if (loaded.state !== 'ready') return null;
    const needle = filter.trim().toLowerCase();
    if (!needle) return null;
    const found = new Set<number>();
    loaded.info.models.forEach((name, index) => {
      if (name.toLowerCase().includes(needle)) found.add(index);
    });
    return found;
  }, [loaded, filter]);

  useEffect(() => {
    handle.current?.showInteriors(showInteriors);
  }, [showInteriors]);

  useEffect(() => {
    if (focus) handle.current?.focus(focus.x, focus.y, 400);
  }, [focus]);

  useEffect(() => {
    handle.current?.highlight(matching);
  }, [matching]);

  useEffect(() => {
    handle.current?.mark(picked);
  }, [picked]);

  const matchingCount = useMemo(() => {
    if (loaded.state !== 'ready' || !matching) return 0;
    let count = 0;
    for (let index = 0; index < loaded.points.count; index++)
      if (matching.has(at(loaded.points.models, index))) count++;
    return count;
  }, [loaded, matching]);

  if (loaded.state === 'loading') {
    return (
      <LoadingPanel
        icon={MapIcon}
        title="Reading the map"
        note="The first time reads every map file of levels.rpf (a few minutes); then it is cached."
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

  const { info, points } = loaded;
  const model = picked === null ? null : (info.models[at(points.models, picked)] ?? null);
  const instances =
    picked === null ? 0 : points.models.reduce((sum, value) => sum + (value === at(points.models, picked) ? 1 : 0), 0);
  const [minX, minY, maxX, maxY] = info.summary.bounds;
  return (
    <div className="flex min-w-0 flex-1">
      <main aria-label="Map" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Map</span>
          <span className="font-mono tabular-nums">
            {info.summary.entities.toLocaleString('en-US')} entities · {info.summary.models.toLocaleString('en-US')}{' '}
            models · {info.summary.files.toLocaleString('en-US')} map files ·{' '}
            {Math.round(maxX - minX).toLocaleString('en-US')} × {Math.round(maxY - minY).toLocaleString('en-US')} m
          </span>
          <label className="ml-auto flex items-center gap-1">
            <input
              type="checkbox"
              checked={showInteriors}
              onChange={(event) => setShowInteriors(event.target.checked)}
              className="accent-primary"
            />
            Interiors ({info.interiors.length.toLocaleString('en-US')})
          </label>
          {matching && (
            <span className="text-foreground">
              {matchingCount.toLocaleString('en-US')} placed of {matching.size.toLocaleString('en-US')} matching models
            </span>
          )}
        </div>
        <div ref={host} className="relative min-h-0 flex-1" />
        <p className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-xs text-muted-foreground">
          <span>Drag to pan · wheel to zoom · click an entity</span>
          <span className="ml-auto">
            North up · coloured by height · type a model name in the filter box to light it up
          </span>
        </p>
      </main>
      {picked !== null && model !== null && (
        <PreviewPane title={model} subtitle="Map entity" onOpen={null}>
          <PreviewSection>
            <Properties
              rows={[
                ['Model', model],
                [
                  'Position',
                  `${at(points.positions, picked * 3).toFixed(1)}, ${at(points.positions, picked * 3 + 1).toFixed(1)}, ${at(points.positions, picked * 3 + 2).toFixed(1)}`,
                ],
                ['Placed', `${instances.toLocaleString('en-US')} times`],
              ]}
            />
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={() => onFind(model)}
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-foreground hover:bg-muted"
              >
                <Search className="size-3.5" />
                Find its model
              </button>
              <button
                type="button"
                onClick={() =>
                  handle.current?.focus(at(points.positions, picked * 3), at(points.positions, picked * 3 + 1), 200)
                }
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-foreground hover:bg-muted"
              >
                <Crosshair className="size-3.5" />
                Zoom in
              </button>
            </div>
          </PreviewSection>
        </PreviewPane>
      )}
    </div>
  );
}
