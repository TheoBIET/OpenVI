import { convertFileSrc } from '@tauri-apps/api/core';
import { FolderDown, Focus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { saveModel } from '../lib/export';
import type { ModelStats, RenderMode, SceneHandle } from '../lib/scene';

const modes: { mode: RenderMode; label: string; hint: string }[] = [
  { mode: 'lit', label: 'Lit', hint: 'Textures and lights: the model as it is meant to look' },
  { mode: 'unlit', label: 'Unlit', hint: 'Textures without lighting: the raw colours' },
  { mode: 'clay', label: 'Clay', hint: 'No textures, plain grey under the lights: the shape only' },
  {
    mode: 'normals',
    label: 'Normals',
    hint: 'Which way each surface faces, as colours: shows flipped or broken faces',
  },
  { mode: 'wireframe', label: 'Wire', hint: 'Triangle edges only: the mesh density' },
];

/** A GLB file on disk in an orbitable 3D view; `actions` go in the header bar. */
export function ModelView({ path, title, actions }: { path: string; title: string; actions?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept from one model to the next.
  const [mode, setMode] = useState<RenderMode>('lit');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setStats(null);
    setError(null);
    setSaved(null);
    void import('../lib/scene').then(({ mountScene }) => {
      if (disposed || !host.current) return;
      // The asset protocol serves the file, so the textures beside it resolve by their relative paths.
      handle.current = mountScene(host.current, convertFileSrc(path), setStats, (failure) =>
        setError(`Cannot show this model: ${String(failure)}`),
      );
      handle.current.setMode(modeRef.current);
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
        {saved && <span className="truncate">{saved}</span>}
        <span className="ml-auto flex items-center gap-1">
          {actions}
          <button
            type="button"
            title="Copy the GLB and its textures to a folder"
            onClick={() =>
              saveModel(path).then(
                (dest) => dest && setSaved(`Exported to ${dest}`),
                (error: unknown) => setSaved(String(error)),
              )
            }
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
          >
            <FolderDown className="size-3.5" />
            Export
          </button>
          <span
            role="radiogroup"
            aria-label="Render mode"
            className="flex items-center rounded-sm border border-border"
          >
            {modes.map((item) => (
              <button
                key={item.mode}
                type="button"
                role="radio"
                aria-checked={mode === item.mode}
                title={item.hint}
                onClick={() => {
                  handle.current?.setMode(item.mode);
                  setMode(item.mode);
                }}
                className={`h-6 px-1.5 first:rounded-l-sm last:rounded-r-sm ${
                  mode === item.mode ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </span>
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
