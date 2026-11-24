import { save } from '@tauri-apps/plugin-dialog';
import { ArrowDown, ArrowUp, Car, FileDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  type CatalogProgress,
  onCatalogProgress,
  saveExport,
  type Vehicle,
  type VehicleCatalog,
  vehicleList,
  vehiclesCsv,
} from '../lib/catalog';
import { formatSize } from '../lib/format';
import { vehiclePreview } from '../lib/model';
import { ModelPreview, PreviewPane, PreviewSection, Properties, useSettled } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; catalog: VehicleCatalog } | { state: 'failed'; error: string };

type Column = {
  key: keyof Vehicle;
  label: string;
  width: string;
  numeric?: boolean;
  format?: (vehicle: Vehicle) => string;
};

const number = (value: number | null, digits = 0) =>
  value === null ? '' : value.toLocaleString('en-US', { maximumFractionDigits: digits });

const columns: Column[] = [
  { key: 'displayName', label: 'Name', width: 'minmax(10rem,1.4fr)', format: (v) => v.displayName ?? v.model ?? '' },
  { key: 'model', label: 'Model', width: 'minmax(8rem,1fr)', format: (v) => v.model ?? v.modelHash },
  { key: 'make', label: 'Make', width: 'minmax(6rem,0.8fr)' },
  {
    key: 'handlingName',
    label: 'Handling',
    width: 'minmax(7rem,0.8fr)',
    format: (v) => v.handlingName ?? v.handlingId ?? '',
  },
  { key: 'mass', label: 'Mass kg', width: '5.5rem', numeric: true, format: (v) => number(v.mass) },
  { key: 'maxSpeed', label: 'Top km/h', width: '5.5rem', numeric: true, format: (v) => number(v.maxSpeed) },
  { key: 'gears', label: 'Gears', width: '3.5rem', numeric: true, format: (v) => number(v.gears) },
  { key: 'configurations', label: 'Configs', width: '4.5rem', numeric: true, format: (v) => number(v.configurations) },
  { key: 'colour', label: 'Colour', width: '6rem' },
];

const grid = { gridTemplateColumns: columns.map((column) => column.width).join(' ') };

function compare(a: Vehicle, b: Vehicle, key: keyof Vehicle, descending: boolean): number {
  const x = key === 'displayName' ? (a.displayName ?? a.model) : a[key];
  const y = key === 'displayName' ? (b.displayName ?? b.model) : b[key];
  // Missing values last, whichever the direction.
  if (x === null) return y === null ? 0 : 1;
  if (y === null) return -1;
  const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  return descending ? -order : order;
}

/** The vehicle catalog as a sortable table; the filter box narrows it, double-click opens the vehicle in 3D. */
export function VehiclesView({
  root,
  filter,
  onOpen,
}: {
  root: string;
  filter: string;
  onOpen: (vehicle: Vehicle) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [sort, setSort] = useState<{ key: keyof Vehicle; descending: boolean }>({
    key: 'displayName',
    descending: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  /** The row the preview pane shows. */
  const [selected, setSelected] = useState<Vehicle | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setLoaded({ state: 'loading' });
    vehicleList(root).then(
      (catalog) => current && setLoaded({ state: 'ready', catalog }),
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
    const matching = needle
      ? loaded.catalog.vehicles.filter((v) =>
          [v.displayName, v.model, v.make, v.modelHash, v.handlingName].some((text) =>
            text?.toLowerCase().includes(needle),
          ),
        )
      : loaded.catalog.vehicles;
    return [...matching].sort((a, b) => compare(a, b, sort.key, sort.descending));
  }, [loaded, filter, sort]);

  async function exportAs(format: 'csv' | 'json') {
    const path = await save({
      title: 'Export vehicles',
      defaultPath: `vehicles.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return;
    const contents = format === 'csv' ? vehiclesCsv(rows) : `${JSON.stringify(rows, null, 2)}\n`;
    try {
      await saveExport(path, contents);
      setNotice(`${rows.length} vehicles written to ${path}`);
    } catch (error) {
      setNotice(String(error));
    }
  }

  if (loaded.state === 'loading') {
    const ratio = progress && progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 0;
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center p-10" aria-busy="true">
        <div className="flex w-80 flex-col items-center text-center">
          <Car className="mb-3 size-8 text-primary" />
          <h2 className="font-title text-foreground">Reading the vehicle tables</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The first time scans packs.rpf and data.rpf; then decoding takes a few seconds.
          </p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-accent-gradient" style={{ width: `${ratio * 100}%` }} />
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
            {progress
              ? `${progress.archive} · ${progress.phase === 'carving' ? `finding resources ${formatSize(progress.done)}` : `reading names ${progress.done}`}`
              : 'Decoding…'}
          </p>
        </div>
      </main>
    );
  }

  if (loaded.state === 'failed') {
    return (
      <p className="grid min-w-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">
        {loaded.error}
      </p>
    );
  }

  const all = loaded.catalog.vehicles;
  return (
    <div className="flex min-w-0 flex-1">
      <main aria-label="Vehicles" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Vehicles</span>
          <span className="font-mono tabular-nums">
            {rows.length === all.length ? `${all.length} models` : `${rows.length} of ${all.length} models`}
          </span>
          <span>{all.filter((v) => v.displayName).length} with a display name</span>
          {notice && <span className="truncate text-warning">{notice}</span>}
          <span className="ml-auto flex items-center gap-1">
            {(['csv', 'json'] as const).map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => void exportAs(format)}
                className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
              >
                <FileDown className="size-3.5" />
                {format.toUpperCase()}
              </button>
            ))}
          </span>
        </div>
        <div className="grid h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs" style={grid}>
          {columns.map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() =>
                setSort((previous) => ({
                  key: column.key,
                  descending: previous.key === column.key ? !previous.descending : column.numeric === true,
                }))
              }
              className={`flex items-center gap-1 truncate text-muted-foreground hover:text-foreground ${column.numeric ? 'justify-end' : ''}`}
            >
              {column.label}
              {sort.key === column.key &&
                (sort.descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {rows.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">No vehicle matches.</p>}
          {rows.map((vehicle) => (
            <div
              key={vehicle.modelHash}
              role="row"
              title={vehicle.model ? `Double-click to see ${vehicle.model} in 3D` : vehicle.modelHash}
              onClick={() => setSelected(vehicle)}
              onDoubleClick={() => onOpen(vehicle)}
              className={`grid h-6 cursor-default items-center gap-3 px-3 ${
                selected?.modelHash === vehicle.modelHash ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
              style={grid}
            >
              {columns.map((column) => {
                const text = column.format ? column.format(vehicle) : String(vehicle[column.key] ?? '');
                if (column.key === 'colour') {
                  return (
                    <span
                      key={column.key}
                      className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"
                    >
                      {vehicle.colour && (
                        <span
                          className="size-3 shrink-0 rounded-sm border border-border"
                          style={{ backgroundColor: vehicle.colour }}
                        />
                      )}
                      {vehicle.colour ?? ''}
                    </span>
                  );
                }
                return (
                  <span
                    key={column.key}
                    className={`truncate ${column.numeric ? 'text-right font-mono text-xs text-muted-foreground tabular-nums' : ''} ${
                      column.key === 'model' ? 'font-mono text-xs text-muted-foreground' : ''
                    }`}
                  >
                    {text}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </main>
      {selected && <VehiclePane root={root} vehicle={selected} onOpen={() => onOpen(selected)} />}
    </div>
  );
}

/** The selected vehicle: its data and the car turning in 3D. */
function VehiclePane({ root, vehicle, onOpen }: { root: string; vehicle: Vehicle; onOpen: () => void }) {
  const model = vehicle.model;
  const glb = useSettled(vehicle.modelHash, model ? () => vehiclePreview(root, model, 0) : null, 400);
  return (
    <PreviewPane
      title={vehicle.displayName ?? vehicle.model ?? vehicle.modelHash}
      subtitle={[vehicle.make, vehicle.model].filter(Boolean).join(' · ')}
      onOpen={model ? onOpen : null}
    >
      {model && (
        <PreviewSection>
          <ModelPreview
            loaded={glb}
            waiting="Exporting it with its wheels… (the first time scans levels.rpf, about 3 min)"
          />
        </PreviewSection>
      )}
      <PreviewSection>
        <Properties
          rows={[
            ['Model', vehicle.model, true],
            ['Hash', vehicle.modelHash, true],
            ['Make', vehicle.make],
            ['Handling', vehicle.handlingName ?? vehicle.handlingId, true],
            ['Mass', vehicle.mass === null ? null : `${number(vehicle.mass)} kg`],
            ['Top speed', vehicle.maxSpeed === null ? null : `${number(vehicle.maxSpeed)} km/h`],
            ['Gears', vehicle.gears],
            ['Drive force', vehicle.driveForce === null ? null : number(vehicle.driveForce, 3)],
            ['Steering lock', vehicle.steeringLock === null ? null : `${number(vehicle.steeringLock, 3)} rad`],
            ['Configurations', vehicle.configurations],
            ['Palettes', vehicle.palettes],
            ['Colour', vehicle.colour, true],
            ['Rim', vehicle.rim, true],
            ['Tyre', vehicle.tyre, true],
          ]}
        />
      </PreviewSection>
    </PreviewPane>
  );
}
