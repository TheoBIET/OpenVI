import { ArrowLeft, Compass, MapPin, Sun, Waves } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CELL, mapCell } from '../lib/map';
import type { MapPoints } from '../lib/mapScene';
import type { WorldHandle, WorldStatus } from '../lib/worldScene';

const presets: [string, number][] = [
  ['Dawn', 6],
  ['Morning', 9],
  ['Noon', 12.5],
  ['Afternoon', 15.5],
  ['Sunset', 18.6],
  ['Night', 22.5],
];

const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * The world in 3D, flown through freely, in the spirit of CodeWalker: cells of the map stream in around the camera,
 * the rest of the city stands as points; an Environment panel sets the hour, the sea, the detail and the speed.
 */
export function WorldView({
  root,
  points,
  start,
  onBack,
}: {
  root: string;
  points: MapPoints;
  start: { x: number; y: number };
  onBack: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<WorldHandle | null>(null);
  const [status, setStatus] = useState<WorldStatus | null>(null);
  const [hour, setHour] = useState(10.5);
  const [water, setWater] = useState(true);
  const [speed, setSpeed] = useState(25);
  const [detail, setDetail] = useState(1);
  const [target, setTarget] = useState('');

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    void import('../lib/worldScene').then(({ mountWorld }) => {
      if (disposed) return;
      handle.current = mountWorld(element, points, (column, row) => mapCell(root, column, row, CELL), setStatus, start);
    });
    return () => {
      disposed = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [root, points, start]);

  useEffect(() => handle.current?.setTime(hour), [hour]);
  useEffect(() => handle.current?.setWater(water), [water]);
  useEffect(() => handle.current?.setSpeed(speed), [speed]);
  useEffect(() => handle.current?.setDetail(detail), [detail]);

  function teleport() {
    const [x, y] = target.split(/[\s,;]+/).map(Number);
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) handle.current?.teleport(x, y);
  }

  const clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60) % 60).padStart(2, '0')}`;
  return (
    <main aria-label="World" className="relative flex min-w-0 flex-1">
      <div ref={host} className="absolute inset-0" />
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-border bg-card/90 p-2 text-xs backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-3.5" />
          Map
        </button>
        <span className="h-4 w-px bg-border" />
        <MapPin className="size-3.5 text-primary" />
        <input
          aria-label="Teleport to x, y"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && teleport()}
          placeholder="Teleport: x, y"
          className="h-6 w-40 rounded-sm border border-border bg-background px-2 font-mono text-foreground"
        />
      </div>
      <aside
        aria-label="Environment"
        className="absolute top-3 right-3 w-64 rounded-lg border border-border bg-card/90 p-3 text-xs backdrop-blur"
      >
        <header className="mb-2 flex items-center gap-2">
          <Sun className="size-3.5 text-primary" />
          <h2 className="font-title text-foreground">Environment</h2>
          <span className="ml-auto font-mono text-muted-foreground">{clock}</span>
        </header>
        <input
          aria-label="Time of day"
          type="range"
          min={0}
          max={24}
          step={0.1}
          value={hour}
          onChange={(event) => setHour(Number(event.target.value))}
          className="w-full accent-primary"
        />
        <div className="mt-2 grid grid-cols-3 gap-1">
          {presets.map(([label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => setHour(value)}
              className="h-6 rounded-sm bg-secondary text-muted-foreground hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={water}
            onChange={(event) => setWater(event.target.checked)}
            className="accent-primary"
          />
          <Waves className="size-3.5" />
          Sea
        </label>
        <div className="mt-3 flex items-center gap-2 text-muted-foreground">
          Detail
          <button
            type="button"
            onClick={() => setDetail(Math.max(detail - 1, 1))}
            className="ml-auto size-6 rounded-sm bg-secondary text-foreground"
          >
            −
          </button>
          <span className="w-16 text-center font-mono text-foreground">{(detail * 2 + 1) * CELL} m</span>
          <button
            type="button"
            onClick={() => setDetail(Math.min(detail + 1, 4))}
            className="size-6 rounded-sm bg-secondary text-foreground"
          >
            +
          </button>
        </div>
        <label className="mt-3 block text-muted-foreground">
          <span className="flex">
            Speed<span className="ml-auto font-mono text-foreground">{speed.toFixed(0)} m/s</span>
          </span>
          <input
            type="range"
            min={2}
            max={300}
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>
        <p className="mt-2 text-muted-foreground">
          Drag to look · WASD or ZQSD to fly · Space and C up and down · Shift faster · wheel sets the speed
        </p>
      </aside>
      {status && (
        <div className="absolute bottom-3 left-3 rounded-lg border border-border bg-card/90 px-3 py-2 font-mono text-xs text-muted-foreground backdrop-blur">
          <p className="flex items-center gap-2 text-foreground">
            <Compass className="size-3.5 text-primary" />
            {compass[Math.round(status.heading / 45) % 8]} {status.heading.toFixed(0)}° · {status.fps} fps
          </p>
          <p>
            {status.x.toFixed(1)} {status.y.toFixed(1)} {status.z.toFixed(1)}
          </p>
          <p>
            {status.loaded} cells{status.fetching ? ` · loading ${status.fetching}…` : ''}
          </p>
          {status.error && <p className="max-w-80 truncate text-destructive">{status.error}</p>}
        </div>
      )}
    </main>
  );
}
