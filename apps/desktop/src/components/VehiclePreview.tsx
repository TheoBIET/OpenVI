import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type CatalogProgress, onCatalogProgress, type Vehicle } from '../lib/catalog';
import { formatSize } from '../lib/format';
import { vehiclePreview } from '../lib/model';
import { ModelView } from './ModelView';

type Loaded = { state: 'loading' } | { state: 'ready'; path: string } | { state: 'failed'; error: string };

/** One vehicle in 3D, in one of its spawn configurations (body colour, rim, tyre). */
export function VehiclePreview({
  root,
  vehicle,
  onFind,
}: {
  root: string;
  vehicle: Vehicle;
  onFind: (model: string) => void;
}) {
  const [config, setConfig] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const name = vehicle.model ?? vehicle.modelHash;
  const title = vehicle.displayName ? `${vehicle.displayName} (${name})` : name;

  useEffect(() => {
    if (!vehicle.model) {
      setLoaded({ state: 'failed', error: 'This vehicle has no known model name, so its models cannot be found.' });
      return;
    }
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setLoaded({ state: 'loading' });
    setProgress(null);
    vehiclePreview(root, vehicle.model, config).then(
      (path) => current && setLoaded({ state: 'ready', path }),
      (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root, vehicle.model, config]);

  const actions = (
    <>
      {vehicle.configurations > 1 && (
        <label className="flex items-center gap-1">
          Configuration
          <select
            value={config}
            onChange={(event) => setConfig(Number(event.target.value))}
            className="h-6 rounded-sm border border-border bg-background px-1 text-foreground"
          >
            {Array.from({ length: vehicle.configurations }, (_, index) => (
              <option key={index} value={index}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {vehicle.model && (
        <button
          type="button"
          onClick={() => vehicle.model && onFind(vehicle.model)}
          className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
        >
          <Search className="size-3.5" />
          Resources
        </button>
      )}
    </>
  );

  if (loaded.state === 'ready') return <ModelView path={loaded.path} title={title} actions={actions} />;
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{title}</span>
        <span className="ml-auto flex items-center gap-1">{actions}</span>
      </div>
      {loaded.state === 'loading' ? (
        <div className="grid flex-1 place-items-center text-center text-xs text-muted-foreground">
          <div>
            <p>Exporting {name} with its wheels…</p>
            {progress && (
              <p className="mt-1 font-mono tabular-nums">
                {progress.archive} ·{' '}
                {progress.phase === 'carving'
                  ? `finding resources ${formatSize(progress.done)} of ${formatSize(progress.total)}`
                  : `reading names ${progress.done} of ${progress.total}`}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="grid flex-1 place-items-center px-10 text-center text-xs text-destructive">{loaded.error}</p>
      )}
    </main>
  );
}
