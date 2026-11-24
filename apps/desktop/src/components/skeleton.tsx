import { LoaderCircle } from 'lucide-react';

/** A placeholder block with a slow shimmer, sized by `className` to the content it stands for. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block rounded-sm ${className}`} />;
}

/** Text lines still loading: `count` bars of varied widths. */
export function SkeletonLines({ count, className = '' }: { count: number; className?: string }) {
  const widths = ['w-11/12', 'w-4/5', 'w-full', 'w-2/3', 'w-5/6', 'w-3/4'];
  return (
    <span aria-hidden="true" className={`flex flex-col gap-1.5 ${className}`}>
      {Array.from({ length: count }, (_, line) => (
        <Skeleton key={line} className={`h-3 ${widths[line % widths.length]}`} />
      ))}
    </span>
  );
}

/** Over content that is being replaced: the old content stays, blurred, under a spinner and what is going on. */
export function BusyOverlay({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="absolute inset-0 z-10 grid place-items-center bg-background/40 backdrop-blur-sm transition-opacity"
    >
      <span className="flex items-center gap-2 rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs text-foreground shadow-lg">
        <LoaderCircle className="size-3.5 animate-spin text-primary" />
        {label}
      </span>
    </div>
  );
}

/** The space a 3D view will take, while its first model loads. */
export function StageSkeleton({ label, square = false }: { label: string; square?: boolean }) {
  return (
    <div
      role="status"
      className={`relative overflow-hidden rounded-sm ${square ? 'aspect-square border border-border' : 'min-h-0 flex-1'}`}
    >
      <Skeleton className="absolute inset-0 rounded-none" />
      <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
        <span className="flex items-center gap-2 px-4 text-center">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
          {label}
        </span>
      </span>
    </div>
  );
}

/** The space a text document takes while it is read or the editor loads: lines of code, top to bottom. */
export function CodeSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="absolute inset-0 overflow-hidden bg-background px-4 py-3">
      <SkeletonLines count={28} className="max-w-3xl" />
    </div>
  );
}
