import { ArrowLeft, Box, Crosshair, Map as MapIcon, Plane, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { at, type MapArea, mapArea, type MapInfo, mapInfo, mapPoints } from '../lib/map';
import type { MapHandle, MapPoints } from '../lib/mapScene';
import { LoadingPanel, StepProgress } from './LoadingPanel';
import { ModelView } from './ModelView';
import { PreviewPane, PreviewSection, Properties } from './preview';
import { WorldView } from './WorldView';

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
  /** The area shown in 3D: being put together, ready, or failed. */
  const [area, setArea] = useState<
    | { state: 'loading'; x: number; y: number }
    | { state: 'ready'; x: number; y: number; value: MapArea }
    | { state: 'failed'; error: string }
    | null
  >(null);

  /** The free-flying world, from this point. */
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);
  /** The 3D area or the world replace the map: its scene is mounted again when the map comes back. */
  const mapHidden = area !== null || world !== null;

  function openArea(x: number, y: number) {
    setArea({ state: 'loading', x, y });
    mapArea(root, x, y, 100).then(
      (value) => setArea({ state: 'ready', x, y, value }),
      (error: unknown) => setArea({ state: 'failed', error: String(error) }),
    );
  }

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
    if (loaded.state !== 'ready' || !host.current || mapHidden) return;
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
  }, [loaded, mapHidden]);

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
  if (world) return <WorldView root={root} points={points} start={world} onBack={() => setWorld(null)} />;
  if (area) {
    const back = (
      <button
        type="button"
        onClick={() => setArea(null)}
        className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
      >
        <ArrowLeft className="size-3.5" />
        Map
      </button>
    );
    if (area.state === 'ready') {
      return (
        <ModelView
          path={area.value.manifest}
          title={`Around ${area.x.toFixed(0)}, ${area.y.toFixed(0)} · ${area.value.entities.toLocaleString('en-US')} entities, ${area.value.models} models`}
          actions={back}
          banner={
            area.value.missing > 0 ? `${area.value.missing} entities left out (no model found or exported).` : null
          }
        />
      );
    }
    return (
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-xs">
        {area.state === 'loading' ? (
          <div className="flex w-96 flex-col items-center text-center">
            <Box className="mb-3 size-8 text-primary" />
            <h2 className="font-title text-foreground">Putting the area together in 3D</h2>
            <p className="mt-1 mb-4 text-muted-foreground">
              The first time exports every model within 100 m (a minute or more); then they are reused.
            </p>
            <StepProgress step={progress} idle="Starting…" />
          </div>
        ) : (
          <p className="text-destructive">{area.error}</p>
        )}
        {back}
      </main>
    );
  }
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
          <button
            type="button"
            title="Fly through the world from the centre of the view"
            onClick={() => {
              const centre = handle.current?.center();
              if (centre) setWorld(centre);
            }}
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-sm bg-accent-gradient px-2 font-semibold text-on-accent"
          >
            <Plane className="size-3.5" />
            Fly here
          </button>
          <button
            type="button"
            title="See the area around the centre of the view in 3D (100 m around)"
            onClick={() => {
              const centre = handle.current?.center();
              if (centre) openArea(centre.x, centre.y);
            }}
            className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-foreground hover:bg-muted"
          >
            <Box className="size-3.5" />
            3D here
          </button>
          <label className="flex items-center gap-1">
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
              <button
                type="button"
                onClick={() => openArea(at(points.positions, picked * 3), at(points.positions, picked * 3 + 1))}
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-foreground hover:bg-muted"
              >
                <Box className="size-3.5" />
                3D around
              </button>
              <button
                type="button"
                onClick={() =>
                  setWorld({ x: at(points.positions, picked * 3), y: at(points.positions, picked * 3 + 1) })
                }
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-foreground hover:bg-muted"
              >
                <Plane className="size-3.5" />
                Fly here
              </button>
            </div>
          </PreviewSection>
        </PreviewPane>
      )}
    </div>
  );
}
