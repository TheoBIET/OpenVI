import { Eye, FolderDown, Focus, Palette } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { saveModel } from '../lib/export';
import type { RenderMode } from '../lib/scene';
import { AnimationBar } from './AnimationBar';
import { MaterialsPanel } from './MaterialsPanel';
import { BusyOverlay, StageSkeleton } from './skeleton';
import { useBufferedScene } from './useBufferedScene';

const modes: { mode: RenderMode; label: string; hint: string }[] = [
  { mode: 'lit', label: 'Lit (textures and lights)', hint: 'Textures and lights: the model as it is meant to look' },
  { mode: 'unlit', label: 'Unlit (textures only)', hint: 'Textures without lighting: the raw colours' },
  { mode: 'clay', label: 'Clay (shape only)', hint: 'No textures, plain grey under the lights: the shape only' },
  {
    mode: 'normals',
    label: 'Normals (surface directions)',
    hint: 'Which way each surface faces, as colours: shows flipped or broken faces',
  },
  { mode: 'wireframe', label: 'Wireframe (triangle edges)', hint: 'Triangle edges only: the mesh density' },
];

/**
 * A GLB file on disk in an orbitable 3D view; `actions` go in the header bar. A new `path` loads under the model on
 * screen, which stays (blurred, under a spinner) until the new one fades in. `busy` says the caller is preparing a
 * new GLB (an assembly), shown the same way; `banner` reports a problem without losing the model on screen.
 */
export function ModelView({
  path,
  title,
  actions,
  busy = null,
  banner = null,
}: {
  path: string;
  title: string;
  actions?: ReactNode;
  busy?: string | null;
  banner?: string | null;
}) {
  const stage = useRef<HTMLDivElement>(null);
  // Kept from one model to the next.
  const [mode, setMode] = useState<RenderMode>('lit');
  const [saved, setSaved] = useState<string | null>(null);
  // Kept open from one model to the next, like the render mode.
  const [showMaterials, setShowMaterials] = useState(false);

  const { handle, stats, error, loading } = useBufferedScene(stage, path, { mode });

  useEffect(() => {
    setSaved(null);
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
        {stats && (
          <span
            className={stats.missingTextures.length > 0 ? 'text-warning' : ''}
            title={
              stats.missingTextures.length > 0
                ? ['Missing (the materials show without them):', ...stats.missingTextures].join('\n')
                : undefined
            }
          >
            {stats.textures} textures
            {stats.missingTextures.length > 0 && `, ${stats.missingTextures.length} missing`}
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
          <label className="flex items-center gap-1" title={modes.find((item) => item.mode === mode)?.hint}>
            <Eye className="size-3.5" />
            <select
              aria-label="Render mode"
              value={mode}
              onChange={(event) => {
                const next = modes.find((item) => item.mode === event.target.value)?.mode ?? 'lit';
                handle?.setMode(next);
                setMode(next);
              }}
              className="h-6 rounded-sm border border-border bg-background px-1 text-foreground"
            >
              {modes.map((item) => (
                <option key={item.mode} value={item.mode} title={item.hint}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => handle?.frame()}
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
          >
            <Focus className="size-3.5" />
            Frame
          </button>
          <button
            type="button"
            aria-pressed={showMaterials}
            title="Each material's textures and why one is missing"
            onClick={() => setShowMaterials(!showMaterials)}
            className={`inline-flex h-6 items-center gap-1 rounded-sm px-1.5 ${
              showMaterials ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-muted'
            }`}
          >
            <Palette className="size-3.5" />
            Materials
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={stage} className="absolute inset-0" />
          {!stats && !error && <StageSkeleton label={busy ?? 'Loading model…'} />}
          {stats && (loading || busy) && <BusyOverlay label={busy ?? 'Loading model…'} />}
          {!stats && error && (
            <p className="absolute inset-0 grid place-items-center px-10 text-center text-xs text-destructive">
              {error}
            </p>
          )}
          {stats && (banner ?? error) && (
            <p
              role="alert"
              className="absolute inset-x-3 top-3 z-20 rounded-md border border-destructive/40 bg-card/95 px-3 py-1.5 text-xs text-destructive"
            >
              {banner ?? error}
            </p>
          )}
        </div>
        {showMaterials && <MaterialsPanel glb={path} />}
      </div>
      {stats && handle && stats.animations.length > 0 && <AnimationBar handle={handle} animations={stats.animations} />}
      <p className="h-6 shrink-0 border-t border-border bg-card px-3 text-xs leading-6 text-muted-foreground">
        Drag to orbit · right-drag to pan · wheel to zoom
      </p>
    </main>
  );
}

/**
 * The 3D view's frame while its first GLB is being prepared (an export, an assembly): same header, stage and footer
 * as {@link ModelView}, so nothing moves when the model arrives. `error` replaces the stage with the reason.
 */
export function ModelViewSkeleton({
  title,
  label,
  actions,
  error = null,
}: {
  title: string;
  label: string;
  actions?: ReactNode;
  error?: string | null;
}) {
  return (
    <main aria-label={title} aria-busy={error === null} className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{title}</span>
        <span className="ml-auto flex items-center gap-1">{actions}</span>
      </div>
      {error === null ? (
        <StageSkeleton label={label} />
      ) : (
        <p className="grid min-h-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">{error}</p>
      )}
      <p className="h-6 shrink-0 border-t border-border bg-card px-3 text-xs leading-6 text-muted-foreground">
        Drag to orbit · right-drag to pan · wheel to zoom
      </p>
    </main>
  );
}
