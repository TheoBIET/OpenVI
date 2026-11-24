import { FolderOpen } from 'lucide-react';

import { Logo } from '../Logo';

export function EmptyState({ error, onOpen }: { error: string | null; onOpen: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Logo className="mb-5 size-14" />
        <h1 className="font-display text-3xl text-foreground">Open your GTA VI folder</h1>
        <p className="mt-1.5 text-muted-foreground">
          OpenVI reads the folder you choose. Nothing is decrypted, uploaded or modified.
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-5 inline-flex h-8 items-center gap-2 rounded-lg bg-accent-gradient px-3.5 font-semibold text-on-accent transition hover:brightness-110"
        >
          <FolderOpen className="size-4" />
          Open folder…
        </button>
        {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
      </div>
    </main>
  );
}
