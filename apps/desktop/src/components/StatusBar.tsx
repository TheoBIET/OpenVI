import { formatSize } from '../lib/format';
import type { Entry } from '../lib/fs';

type StatusBarProps = {
  shown: number;
  selected: Entry | undefined;
  notice: string | null;
  folderName: string | undefined;
};

export function StatusBar({ shown, selected, notice, folderName }: StatusBarProps) {
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-ink-800 bg-ink-900 px-3 text-[11px] text-ink-400">
      <span>{shown} items shown</span>
      <span className="h-3 w-px bg-ink-800" />
      <span>
        {selected
          ? `1 selected item${selected.kind === 'folder' ? '' : ` · ${formatSize(selected.size)}`}`
          : 'No selected items'}
      </span>
      {notice && <span className="truncate text-sunset">{notice}</span>}
      <span className="ml-auto flex items-center gap-3">
        {folderName && <span>{folderName}</span>}
        <span className="font-mono">OpenVI {import.meta.env.VITE_APP_VERSION}</span>
      </span>
    </footer>
  );
}
