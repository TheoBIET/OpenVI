import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** One vehicle model, as the backend's catalog flattens it. */
export type Vehicle = {
  model: string | null;
  /** Joaat hash of the model name, 8 hex digits: the stable id. */
  modelHash: string;
  displayName: string | null;
  make: string | null;
  handlingId: string | null;
  handlingName: string | null;
  configurations: number;
  palettes: number;
  /** First configuration's body colour, `#rrggbb`. */
  colour: string | null;
  rim: string | null;
  tyre: string | null;
  steeringLock: number | null;
  mass: number | null;
  maxSpeed: number | null;
  gears: number | null;
  driveForce: number | null;
};

export type VehicleCatalog = { vehicles: Vehicle[]; vehiclesJson: string; handlingJson: string | null };

export type CatalogProgress = { archive: string; phase: 'carving' | 'naming'; done: number; total: number };

/** Decoding takes seconds: one catalog per game folder per session. */
const cache = new Map<string, Promise<VehicleCatalog>>();

/** The vehicle catalog of the game folder `root`; scans `packs.rpf` and `data.rpf` first when needed. */
export function vehicleList(root: string): Promise<VehicleCatalog> {
  let pending = cache.get(root);
  if (!pending) {
    pending = invoke<VehicleCatalog>('vehicle_list', { root });
    // A failure is not cached: the next opening tries again.
    pending.catch(() => cache.delete(root));
    cache.set(root, pending);
  }
  return pending;
}

export function onCatalogProgress(handler: (progress: CatalogProgress) => void): Promise<UnlistenFn> {
  return listen<CatalogProgress>('catalog-progress', (event) => handler(event.payload));
}

/** Writes an export the user picked a path for (CSV or JSON). */
export function saveExport(path: string, contents: string): Promise<void> {
  return invoke('save_export', { path, contents });
}

const columns: (keyof Vehicle)[] = [
  'modelHash',
  'model',
  'displayName',
  'make',
  'handlingId',
  'handlingName',
  'configurations',
  'palettes',
  'colour',
  'rim',
  'tyre',
  'steeringLock',
  'mass',
  'maxSpeed',
  'gears',
  'driveForce',
];

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function vehiclesCsv(vehicles: Vehicle[]): string {
  const lines = vehicles.map((vehicle) => columns.map((column) => cell(vehicle[column])).join(','));
  return `${[columns.join(','), ...lines].join('\n')}\n`;
}
