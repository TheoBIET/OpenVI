import { ArrowLeft, ArrowRight, ArrowUp, Car, ChevronRight, Database, FolderOpen, Search } from 'lucide-react';
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
  /** Enter in the filter box: search every indexed archive. */
  onSearch: (query: string) => void;
  onOpenFolder: () => void;
  /** Null when no game folder is open. */
  indexLabel: string | null;
  indexing: boolean;
  onIndex: () => void;
  vehiclesOpen: boolean;
  onVehicles: () => void;
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
      className="inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

export function Toolbar(props: ToolbarProps) {
  const current = props.crumbs.at(-1);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
      <ToolButton icon={FolderOpen} label="Open game folder" onClick={props.onOpenFolder}>
        <span className="text-xs">Open</span>
      </ToolButton>
      <span className="h-5 w-px bg-muted" />
      <ToolButton icon={ArrowLeft} label="Back" disabled={!props.canBack} onClick={props.onBack} />
      <ToolButton icon={ArrowRight} label="Forward" disabled={!props.canForward} onClick={props.onForward} />
      <ToolButton icon={ArrowUp} label="Up one level" disabled={!props.canUp} onClick={props.onUp} />
      {props.indexLabel !== null && (
        <>
          <span className="h-5 w-px bg-muted" />
          <ToolButton
            icon={Database}
            label="Scan every archive into the index, for search"
            disabled={props.indexing}
            onClick={props.onIndex}
          >
            <span className="text-xs">{props.indexLabel}</span>
          </ToolButton>
          <ToolButton icon={Car} label="Vehicle catalog" disabled={props.vehiclesOpen} onClick={props.onVehicles}>
            <span className="text-xs">Vehicles</span>
          </ToolButton>
        </>
      )}

      <nav
        aria-label="Path"
        className="flex h-7 min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-sm border border-border bg-background px-2"
      >
        <span className="mr-1 text-accent-gradient font-display text-base">OpenVI</span>
        {props.crumbs.map((crumb, index) => (
          <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 shrink-0 text-input" />
            <button
              type="button"
              title={crumb.path}
              onClick={() => props.onNavigate(crumb.path)}
              className={`truncate rounded-sm px-1 hover:bg-muted ${index === props.crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <label className="flex h-7 w-72 items-center gap-2 rounded-sm border border-border bg-background px-2 focus-within:border-primary/60">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={props.filter}
          onChange={(event) => props.onFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onSearch(props.filter);
          }}
          placeholder={current ? `Filter ${current.name} · Enter searches all` : 'Filter'}
          title="Type to filter this list; press Enter to search every indexed archive"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
    </header>
  );
}
