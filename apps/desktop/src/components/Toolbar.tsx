import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, FolderOpen, Search } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import type { Crumb } from '../lib/fs';

type ToolbarProps = {
  crumbs: Crumb[];
  filter: string;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavigate: (path: string) => void;
  onFilter: (text: string) => void;
  onOpenFolder: () => void;
};

function ToolButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-ink-200 transition-colors hover:bg-ink-800 hover:text-white disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

export function Toolbar(props: ToolbarProps) {
  const current = props.crumbs.at(-1);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 px-2">
      <ToolButton icon={FolderOpen} label="Open game folder" onClick={props.onOpenFolder}>
        <span className="text-xs">Open</span>
      </ToolButton>
      <span className="h-5 w-px bg-ink-800" />
      <ToolButton icon={ArrowLeft} label="Back" disabled={!props.canBack} onClick={props.onBack} />
      <ToolButton icon={ArrowRight} label="Forward" disabled={!props.canForward} onClick={props.onForward} />
      <ToolButton icon={ArrowUp} label="Up one level" disabled={!props.canUp} onClick={props.onUp} />

      <nav
        aria-label="Path"
        className="flex h-7 min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded border border-ink-800 bg-ink-950 px-2"
      >
        <span className="mr-1 text-xs font-semibold text-flamingo">OpenVI</span>
        {props.crumbs.map((crumb, index) => (
          <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 shrink-0 text-ink-700" />
            <button
              type="button"
              title={crumb.path}
              onClick={() => props.onNavigate(crumb.path)}
              className={`truncate rounded px-1 hover:bg-ink-800 ${index === props.crumbs.length - 1 ? 'text-white' : 'text-ink-400'}`}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <label className="flex h-7 w-64 items-center gap-2 rounded border border-ink-800 bg-ink-950 px-2 focus-within:border-flamingo/60">
        <Search className="size-3.5 shrink-0 text-ink-400" />
        <input
          value={props.filter}
          onChange={(event) => props.onFilter(event.target.value)}
          placeholder={current ? `Filter ${current.name}` : 'Filter'}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-ink-400"
        />
      </label>
    </header>
  );
}
