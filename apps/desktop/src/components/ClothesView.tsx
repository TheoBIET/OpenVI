import { Shirt } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Garment, garmentList, garmentPreview, slotLabel } from '../lib/clothes';
import { LoadingPanel } from './LoadingPanel';
import { ModelView, ModelViewSkeleton } from './ModelView';
import { listKeys, ModelPreview, PreviewPane, PreviewSection, Properties, useSettled } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; garments: Garment[] } | { state: 'failed'; error: string };

const slots: Garment['slot'][] = ['top', 'outer', 'bottom', 'full', 'feet'];

const grid = { gridTemplateColumns: 'minmax(10rem,1fr) 7rem 5rem 4rem minmax(10rem,1.2fr)' };

/** Every generic garment; the filter box narrows the list, double-click tries one on a mannequin. */
export function ClothesView({
  root,
  filter,
  onOpen,
}: {
  root: string;
  filter: string;
  onOpen: (garment: Garment) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [slot, setSlot] = useState<'all' | Garment['slot']>('all');
  const [sex, setSex] = useState<'all' | Garment['sex']>('all');
  const [selected, setSelected] = useState<Garment | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setLoaded({ state: 'loading' });
    garmentList(root).then(
      (garments) => current && setLoaded({ state: 'ready', garments }),
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
    return loaded.garments.filter(
      (garment) =>
        (slot === 'all' || garment.slot === slot) &&
        (sex === 'all' || garment.sex === sex) &&
        (garment.name.includes(needle) || garment.label.includes(needle)),
    );
  }, [loaded, filter, slot, sex]);

  if (loaded.state === 'loading') {
    return (
      <LoadingPanel
        icon={Shirt}
        title="Finding the clothes"
        note="The first time scans packs.rpf, where the garments are."
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
      <main aria-label="Clothes" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Clothes</span>
          <span className="font-mono tabular-nums">
            {rows.length === loaded.garments.length
              ? loaded.garments.length.toLocaleString('en-US')
              : `${rows.length.toLocaleString('en-US')} of ${loaded.garments.length.toLocaleString('en-US')}`}
          </span>
          <select
            aria-label="Slot"
            value={slot}
            onChange={(event) => setSlot(slots.find((value) => value === event.target.value) ?? 'all')}
            className="ml-auto h-6 rounded-sm border border-border bg-background px-1 text-foreground"
          >
            <option value="all">All slots</option>
            {slots.map((value) => (
              <option key={value} value={value}>
                {slotLabel[value]}
              </option>
            ))}
          </select>
          <select
            aria-label="Cut"
            value={sex}
            onChange={(event) =>
              setSex(event.target.value === 'male' || event.target.value === 'female' ? event.target.value : 'all')
            }
            className="h-6 rounded-sm border border-border bg-background px-1 text-foreground"
          >
            <option value="all">Men and women</option>
            <option value="female">Women</option>
            <option value="male">Men</option>
          </select>
        </div>
        <div
          className="grid h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground"
          style={grid}
        >
          <span>Garment</span>
          <span>Slot</span>
          <span>Cut</span>
          <span className="text-right">No.</span>
          <span>Model</span>
        </div>
        <div
          tabIndex={0}
          aria-label="Clothes list"
          onKeyDown={listKeys(rows, (row) => row.name, selected, setSelected, onOpen)}
          className="flex-1 overflow-auto outline-none"
        >
          {rows.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">No garment matches.</p>}
          {rows.map((garment) => (
            <div
              key={garment.name}
              role="row"
              title={`Double-click to try ${garment.label} on`}
              data-row={garment.name}
              onClick={() => setSelected(garment)}
              onDoubleClick={() => onOpen(garment)}
              className={`grid h-6 cursor-default items-center gap-3 px-3 ${
                selected?.name === garment.name ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
              style={grid}
            >
              <span className="truncate">{garment.label}</span>
              <span className="truncate text-muted-foreground">{slotLabel[garment.slot]}</span>
              <span className="truncate text-muted-foreground" title={garment.fit}>
                {garment.sex === 'female' ? 'women' : 'men'}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{garment.variant}</span>
              <span className="truncate font-mono text-xs text-muted-foreground" title={garment.name}>
                {garment.name}
              </span>
            </div>
          ))}
        </div>
      </main>
      {selected && <GarmentPane root={root} garment={selected} onOpen={() => onOpen(selected)} />}
    </div>
  );
}

/** The selected garment, worn by a mannequin turning in 3D. */
function GarmentPane({ root, garment, onOpen }: { root: string; garment: Garment; onOpen: () => void }) {
  const glb = useSettled(garment.name, () => garmentPreview(root, garment.name), 400);
  return (
    <PreviewPane title={garment.label} subtitle={slotLabel[garment.slot]} onOpen={onOpen}>
      <PreviewSection>
        <ModelPreview loaded={glb} waiting="Dressing a mannequin…" />
      </PreviewSection>
      <PreviewSection>
        <Properties
          rows={[
            ['Garment', garment.label],
            ['Slot', slotLabel[garment.slot]],
            ['Cut', `${garment.sex === 'female' ? 'women' : 'men'} (${garment.fit})`],
            ['Number', garment.variant],
            ['Model', garment.name],
          ]}
        />
      </PreviewSection>
    </PreviewPane>
  );
}

type Glb = { state: 'loading' } | { state: 'ready'; path: string } | { state: 'failed'; error: string };

/** One garment worn by a mannequin of its fit, in the 3D view. */
export function GarmentPreview({ root, garment }: { root: string; garment: Garment }) {
  const [glb, setGlb] = useState<Glb>({ state: 'loading' });
  useEffect(() => {
    let current = true;
    setGlb({ state: 'loading' });
    garmentPreview(root, garment.name).then(
      (path) => current && setGlb({ state: 'ready', path }),
      (error: unknown) => current && setGlb({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, garment.name]);
  const title = `${garment.label} · ${garment.name}`;
  if (glb.state === 'ready') return <ModelView path={glb.path} title={title} />;
  return (
    <ModelViewSkeleton title={title} label="Dressing a mannequin…" error={glb.state === 'failed' ? glb.error : null} />
  );
}
