import { Package } from 'lucide-react';

import { formatSize } from '../lib/format';
import type { ScanProgress } from '../lib/fs';

function describe({ phase, done, total }: ScanProgress): string {
  if (phase === 'carving') return `Finding resources · ${formatSize(done)} of ${formatSize(total)}`;
  return `Reading names · ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
}

/** Shown in place of the list while an archive is scanned for the first time. */
export function ScanPanel({ name, progress }: { name: string; progress: ScanProgress | null }) {
  const ratio = progress && progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 0;
  const detail = progress ? describe(progress) : 'Opening…';

  return (
    <main className="flex min-w-0 flex-1 items-center justify-center p-10" aria-busy="true">
      <div className="flex w-80 flex-col items-center text-center">
        <Package className="mb-3 size-8 text-sunset" />
        <h2 className="font-semibold text-white">Scanning {name}</h2>
        <p className="mt-1 text-xs text-ink-400">
          The first opening reads the whole archive; later openings answer at once.
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-800"
        >
          <div
            className="h-full bg-linear-to-r from-flamingo via-sunset to-gold transition-[width]"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-ink-400 tabular-nums">
          {detail}
          {progress && ` · ${Math.round(ratio * 100)}%`}
        </p>
      </div>
    </main>
  );
}
