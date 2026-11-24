import { Maximize2 } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { BusyOverlay, Skeleton, SkeletonLines, StageSkeleton } from './skeleton';
import { useBufferedScene } from './useBufferedScene';

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

/** A value still loading: its row keeps its place, with a placeholder, so the pane does not grow when it arrives. */
export const PENDING = Symbol('pending');

/** Label and value rows; a row whose value is missing is left out, one still {@link PENDING} keeps its place. */
export function Properties({
  rows,
}: {
  rows: [string, string | number | null | undefined | typeof PENDING, boolean?][];
}) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([label, value, mono]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            {value === PENDING ? (
              <dd className="flex items-center">
                <Skeleton className="h-3 w-2/3" />
              </dd>
            ) : (
              <dd className={`truncate text-foreground ${mono ? 'font-mono' : ''}`} title={String(value)}>
                {value}
              </dd>
            )}
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

/** The space a {@link TextSnippet} takes, while its text loads. */
export function TextSnippetSkeleton() {
  return (
    <div className="h-40 overflow-hidden rounded-sm border border-border bg-background p-2">
      <SkeletonLines count={9} />
    </div>
  );
}

/**
 * A GLB on disk, turning slowly in a square: the 3D preview of the pane. A new `path` loads under the one on screen,
 * which stays (blurred) until it fades in; `busy` says the caller is preparing the next one.
 */
export function ModelThumb({ path, busy = null }: { path: string; busy?: string | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const { stats, error, loading } = useBufferedScene(stage, path, { autoRotate: true });

  return (
    <div className="relative aspect-square overflow-hidden rounded-sm border border-border bg-background">
      <div ref={stage} className="absolute inset-0" />
      {!stats && !error && (
        <div className="absolute inset-0 flex">
          <StageSkeleton label={busy ?? 'Loading model…'} />
        </div>
      )}
      {stats && (loading || busy) && <BusyOverlay label={busy ?? 'Loading model…'} />}
      {!stats && error && (
        <p className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-destructive">{error}</p>
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

/**
 * Shows a {@link Loaded} model: the turning thumbnail, or its square placeholder while the first one is exported.
 * While the next selection's model is exported, the previous one stays, blurred, under `waiting`.
 */
export function ModelPreview({ loaded, waiting }: { loaded: Loaded<string>; waiting: string }) {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (loaded.state === 'ready') setLast(loaded.value);
  }, [loaded]);

  if (loaded.state === 'failed') {
    return (
      <div className="grid aspect-square place-items-center rounded-sm border border-border px-3 text-center text-destructive">
        {loaded.error}
      </div>
    );
  }
  const path = loaded.state === 'ready' ? loaded.value : last;
  if (path) return <ModelThumb path={path} busy={loaded.state === 'loading' ? waiting : null} />;
  if (loaded.state === 'idle') return null;
  return <StageSkeleton square label={waiting} />;
}

/**
 * Arrow keys move the selection through `rows` (the preview pane follows, and the row scrolls into view), Enter opens
 * it, as in the explorer's list. Rows carry `data-row={key}` for the scrolling.
 */
export function listKeys<T>(
  rows: T[],
  key: (row: T) => string,
  selected: T | null,
  select: (row: T) => void,
  open: (row: T) => void,
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const index = selected ? rows.findIndex((row) => key(row) === key(selected)) : -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)];
      if (!next) return;
      select(next);
      event.currentTarget.querySelector(`[data-row="${CSS.escape(key(next))}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && selected) {
      open(selected);
    }
  };
}
