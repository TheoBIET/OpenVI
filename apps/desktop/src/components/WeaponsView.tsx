import { Crosshair } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Weapon, weaponList, weaponPreview } from '../lib/weapons';
import { LoadingPanel } from './LoadingPanel';
import { listKeys, ModelPreview, PreviewPane, PreviewSection, Properties, useSettled } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; weapons: Weapon[] } | { state: 'failed'; error: string };

const grid = { gridTemplateColumns: 'minmax(12rem,1fr) 10rem 7rem 4rem 4rem' };

/** Every weapon; the filter box narrows the list (name, class or make), double-click opens one in 3D. */
export function WeaponsView({
  root,
  filter,
  onOpen,
}: {
  root: string;
  filter: string;
  onOpen: (weapon: Weapon) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState<Weapon | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setLoaded({ state: 'loading' });
    weaponList(root).then(
      (weapons) => current && setLoaded({ state: 'ready', weapons }),
      (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  const classes = useMemo(() => {
    if (loaded.state !== 'ready') return [];
    return [...new Set(loaded.weapons.map((weapon) => weapon.className))].sort();
  }, [loaded]);

  const rows = useMemo(() => {
    if (loaded.state !== 'ready') return [];
    const needle = filter.trim().toLowerCase();
    return loaded.weapons.filter(
      (weapon) =>
        (kind === 'all' || weapon.className === kind) &&
        (weapon.name.includes(needle) ||
          weapon.className.toLowerCase().includes(needle) ||
          weapon.make.includes(needle)),
    );
  }, [loaded, filter, kind]);

  if (loaded.state === 'loading') {
    return (
      <LoadingPanel
        icon={Crosshair}
        title="Finding the weapons"
        note="The first time scans data.rpf and packs.rpf, where the weapons and their parts are."
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
      <main aria-label="Weapons" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Weapons</span>
          <span className="font-mono tabular-nums">
            {rows.length === loaded.weapons.length
              ? loaded.weapons.length
              : `${rows.length} of ${loaded.weapons.length}`}
          </span>
          <select
            aria-label="Class"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="ml-auto h-6 rounded-sm border border-border bg-background px-1 text-foreground"
          >
            <option value="all">All classes</option>
            {classes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div
          className="grid h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground"
          style={grid}
        >
          <span>Name</span>
          <span>Class</span>
          <span>Make</span>
          <span className="text-right">Parts</span>
          <span className="text-right">Slots</span>
        </div>
        <div
          tabIndex={0}
          aria-label="Weapons list"
          onKeyDown={listKeys(rows, (row) => row.name, selected, setSelected, onOpen)}
          className="flex-1 overflow-auto outline-none"
        >
          {rows.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">No weapon matches.</p>}
          {rows.map((weapon) => (
            <div
              key={weapon.name}
              role="row"
              title={`Double-click to build ${weapon.name} in 3D`}
              data-row={weapon.name}
              onClick={() => setSelected(weapon)}
              onDoubleClick={() => onOpen(weapon)}
              className={`grid h-6 cursor-default items-center gap-3 px-3 ${
                selected?.name === weapon.name ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
              style={grid}
            >
              <span className="truncate font-mono text-xs">{weapon.name}</span>
              <span className="truncate">{weapon.className}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{weapon.make}</span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {weapon.parts || ''}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {weapon.slots || ''}
              </span>
            </div>
          ))}
        </div>
      </main>
      {selected && <WeaponPane root={root} weapon={selected} onOpen={() => onOpen(selected)} />}
    </div>
  );
}

/** The selected weapon: its default build turning in 3D. */
function WeaponPane({ root, weapon, onOpen }: { root: string; weapon: Weapon; onOpen: () => void }) {
  const glb = useSettled(
    weapon.name,
    () => weaponPreview(root, weapon.name, null).then((assembly) => assembly.manifest),
    400,
  );
  return (
    <PreviewPane title={weapon.name} subtitle={weapon.className} onOpen={onOpen}>
      <PreviewSection>
        <ModelPreview loaded={glb} waiting="Building it from its parts…" />
      </PreviewSection>
      <PreviewSection>
        <Properties
          rows={[
            ['Class', `${weapon.className} (${weapon.class})`],
            ['Make', weapon.make],
            ['Model', weapon.model],
            ['Archive', weapon.archive],
            ['Parts', weapon.parts || '—'],
            ['Slots', weapon.slots || '—'],
          ]}
        />
        <p className="mt-2 text-muted-foreground">Open it to change its parts.</p>
      </PreviewSection>
    </PreviewPane>
  );
}
