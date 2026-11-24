import type { LucideIcon } from 'lucide-react';

import { type CatalogProgress, describeStep } from '../lib/catalog';

/**
 * The bar of a long operation: filled to its count when the step has one, else sweeping to show it is at work.
 * Always says which step it is on.
 */
export function StepProgress({ step, idle }: { step: CatalogProgress | null; idle: string }) {
  const counted = step !== null && step.total > 0;
  const ratio = counted ? Math.min(step.done / step.total, 1) : 0;
  return (
    <div className="w-full">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={counted ? Math.round(ratio * 100) : undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {counted ? (
          <div
            className="h-full bg-accent-gradient transition-[width] duration-300"
            style={{ width: `${ratio * 100}%` }}
          />
        ) : (
          <div className="progress-sweep h-full w-1/3 rounded-full bg-accent-gradient" />
        )}
      </div>
      <p
        className="mt-2 min-h-4 truncate font-mono text-xs text-muted-foreground tabular-nums"
        title={step ? describeStep(step) : idle}
      >
        {step ? describeStep(step) : idle}
        {counted && ` · ${Math.round(ratio * 100)}%`}
      </p>
    </div>
  );
}

/** A section's first loading: what it is doing, why it takes a while the first time, and the step it is on. */
export function LoadingPanel({
  icon: Icon,
  title,
  note,
  step,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
  step: CatalogProgress | null;
}) {
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center p-10" aria-busy="true">
      <div className="flex w-96 flex-col items-center text-center">
        <Icon className="mb-3 size-8 text-primary" />
        <h2 className="font-title text-foreground">{title}</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">{note}</p>
        <StepProgress step={step} idle="Starting…" />
      </div>
    </main>
  );
}
