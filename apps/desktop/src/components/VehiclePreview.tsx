import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type CatalogProgress, describeStep, onCatalogProgress, type Vehicle } from '../lib/catalog';
import { vehiclePreview } from '../lib/model';
import { ModelView, ModelViewSkeleton } from './ModelView';

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
  /** The last configuration exported: it stays on screen while the next one is. */
  const [shown, setShown] = useState<string | null>(null);
  const name = vehicle.model ?? vehicle.modelHash;
  const title = vehicle.displayName ? `${vehicle.displayName} (${name})` : name;

  // Another vehicle starts over: its first configuration, and no other car blurred behind it.
  useEffect(() => {
    setConfig(0);
    setShown(null);
  }, [vehicle.modelHash]);

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
      (path) => {
        if (!current) return;
        setLoaded({ state: 'ready', path });
        setShown(path);
      },
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

  // The backend's current step: the scan of levels.rpf the first time, then the export.
  const waiting = progress ? describeStep(progress) : `Exporting ${name} with its wheels…`;

  // The configuration on screen stays (blurred) while the next one is exported.
  if (shown) {
    return (
      <ModelView
        path={shown}
        title={title}
        actions={actions}
        busy={loaded.state === 'loading' ? waiting : null}
        banner={loaded.state === 'failed' ? loaded.error : null}
      />
    );
  }
  return (
    <ModelViewSkeleton
      title={title}
      label={waiting}
      actions={actions}
      error={loaded.state === 'failed' ? loaded.error : null}
    />
  );
}
