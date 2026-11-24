import { convertFileSrc } from '@tauri-apps/api/core';
import { Box, Focus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { ModelStats, SceneHandle } from '../lib/scene';

/** A GLB file on disk in an orbitable 3D view; `actions` go in the header bar. */
export function ModelView({ path, title, actions }: { path: string; title: string; actions?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);

  useEffect(() => {
    let disposed = false;
    setStats(null);
    setError(null);
    setWireframe(false);
    void import('../lib/scene').then(({ mountScene }) => {
      if (disposed || !host.current) return;
      // The asset protocol serves the file, so the textures beside it resolve by their relative paths.
      handle.current = mountScene(host.current, convertFileSrc(path), setStats, (failure) =>
        setError(`Cannot show this model: ${String(failure)}`),
      );
    });
    return () => {
      disposed = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [path]);

  return (
    <main aria-label={title} className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{title}</span>
        {stats && (
          <span className="font-mono tabular-nums">
            {stats.meshes} meshes · {stats.triangles.toLocaleString('en-US')} triangles ·{' '}
            {stats.size.map((side) => side.toFixed(2)).join(' × ')} m
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {actions}
          <button
            type="button"
            aria-pressed={wireframe}
            onClick={() => {
              handle.current?.setWireframe(!wireframe);
              setWireframe(!wireframe);
            }}
            className={`inline-flex h-6 items-center gap-1 rounded-sm px-1.5 ${
              wireframe ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-muted'
            }`}
          >
            <Box className="size-3.5" />
            Wireframe
          </button>
          <button
            type="button"
            onClick={() => handle.current?.frame()}
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
          >
            <Focus className="size-3.5" />
            Frame
          </button>
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        {!stats && !error && (
          <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Loading model…</p>
        )}
        {error && (
          <p className="absolute inset-0 grid place-items-center px-10 text-center text-xs text-destructive">{error}</p>
        )}
      </div>
      <p className="h-6 shrink-0 border-t border-border bg-card px-3 text-xs leading-6 text-muted-foreground">
        Drag to orbit · right-drag to pan · wheel to zoom
      </p>
    </main>
  );
}
