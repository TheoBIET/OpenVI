import { formatSize } from '../lib/format';
import type { Entry } from '../lib/fs';
import { UpdateButton } from './UpdateButton';

type StatusBarProps = {
  shown: number;
  selected: Entry | undefined;
  notice: string | null;
  /** What the index holds, or how an indexing pass is going. */
  index: string | null;
  folderName: string | undefined;
};

export function StatusBar({ shown, selected, notice, index, folderName }: StatusBarProps) {
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-xs text-muted-foreground">
      <span>{shown} items shown</span>
      <span className="h-3 w-px bg-muted" />
      <span>
        {selected
          ? `1 selected item${selected.kind === 'folder' ? '' : ` · ${formatSize(selected.size)}`}`
          : 'No selected items'}
      </span>
      {notice && <span className="truncate text-warning">{notice}</span>}
      <span className="ml-auto flex min-w-0 items-center gap-3">
        {index && <span className="truncate">{index}</span>}
        {folderName && <span>{folderName}</span>}
        <UpdateButton />
      </span>
    </footer>
  );
}
