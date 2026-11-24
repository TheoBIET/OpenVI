import { Maximize2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { SceneHandle } from '../lib/scene';

/**
 * The right-hand preview of whatever is selected: title, what it is, an Open button (the same as a double-click)
 * and the preview itself.
 */
export function PreviewPane({
  title,
  subtitle,
  onOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Opens the item on its own, in place of the list; no button when null. */
  onOpen: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <aside aria-label="Preview" className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-card">
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1">
          <h2 className="truncate font-title text-foreground" title={title}>
            {title}
          </h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </span>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            title="Open it on its own (or double-click)"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent-gradient px-2.5 text-xs font-semibold text-on-accent hover:brightness-110"
          >
            <Maximize2 className="size-3.5" />
            Open
          </button>
        )}
      </header>
      <div className="flex-1 overflow-auto">{children}</div>
    </aside>
  );
}

/** A section of the preview pane, under a small heading. */
export function PreviewSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-2 text-xs">
      {title && <h3 className="mb-1.5 font-title text-accent-solid">{title}</h3>}
      {children}
    </section>
  );
}

/** Label and value rows. */
export function Properties({ rows }: { rows: [string, string | number | null | undefined, boolean?][] }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([label, value, mono]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={`truncate text-foreground ${mono ? 'font-mono' : ''}`} title={String(value)}>
              {value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function PanelButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center rounded-sm border border-border px-2 text-foreground hover:bg-muted"
    >
      {label}
    </button>
  );
}

/** The first lines of a text, small and monospaced. */
export function TextSnippet({ text, lines = 40 }: { text: string; lines?: number }) {
  const shown = text.split('\n').slice(0, lines).join('\n');
  return (
    <pre className="max-h-80 overflow-auto rounded-sm border border-border bg-background p-2 font-mono text-[11px] leading-4 whitespace-pre text-foreground select-text">
      {shown}
    </pre>
  );
}

/** A GLB on disk, turning slowly in a square: the 3D preview of the pane. */
export function ModelThumb({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | string>('loading');

  useEffect(() => {
    let disposed = false;
    let handle: SceneHandle | null = null;
    setState('loading');
    void import('../lib/scene').then(({ mountScene }) => {
      if (disposed || !host.current) return;
      handle = mountScene(
        host.current,
        path,
        () => setState('ready'),
        (error) => setState(`Cannot show this model: ${String(error)}`),
        { autoRotate: true },
      );
    });
    return () => {
      disposed = true;
      handle?.dispose();
    };
  }, [path]);

  return (
    <div className="relative aspect-square overflow-hidden rounded-sm border border-border bg-background">
      <div ref={host} className="absolute inset-0" />
      {state === 'loading' && (
        <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Loading model…</p>
      )}
      {state !== 'loading' && state !== 'ready' && (
        <p className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-destructive">{state}</p>
      )}
    </div>
  );
}

/** What a pane is loading: a value, its error, or nothing yet. */
export type Loaded<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; error: string };

/**
 * Loads `load()` once the selection settles (`delay` ms: walking a list with the arrow keys does not load every
 * row) and again when `key` changes. Null `load` means nothing to load.
 */
export function useSettled<T>(key: string, load: (() => Promise<T>) | null, delay = 250): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'idle' });
  const latest = useRef(load);
  latest.current = load;
  const enabled = load !== null;

  useEffect(() => {
    const run = latest.current;
    if (!run) {
      setLoaded({ state: 'idle' });
      return;
    }
    let current = true;
    setLoaded({ state: 'loading' });
    const timer = setTimeout(() => {
      run().then(
        (value) => current && setLoaded({ state: 'ready', value }),
        (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
      );
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, enabled, delay]);

  return loaded;
}

/** Shows a {@link Loaded} model: the turning thumbnail, a loading line, or the error. */
export function ModelPreview({ loaded, waiting }: { loaded: Loaded<string>; waiting: string }) {
  if (loaded.state === 'ready') return <ModelThumb path={loaded.value} />;
  if (loaded.state === 'failed') return <p className="text-destructive">{loaded.error}</p>;
  if (loaded.state === 'loading') return <p className="text-muted-foreground">{waiting}</p>;
  return null;
}
