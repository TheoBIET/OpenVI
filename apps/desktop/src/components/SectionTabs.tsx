import {
  Car,
  Clapperboard,
  Crosshair,
  DoorOpen,
  Film,
  FolderTree,
  Languages,
  Map as MapIcon,
  Music,
  Shirt,
  Users,
} from 'lucide-react';

export type Section =
  | 'explorer'
  | 'vehicles'
  | 'characters'
  | 'clothes'
  | 'weapons'
  | 'animations'
  | 'cutscenes'
  | 'audio'
  | 'text'
  | 'map'
  | 'interiors';

const sections: { id: Section; label: string; icon: typeof Car; ready: boolean }[] = [
  { id: 'explorer', label: 'Explorer', icon: FolderTree, ready: true },
  { id: 'vehicles', label: 'Vehicles', icon: Car, ready: true },
  { id: 'characters', label: 'Characters', icon: Users, ready: true },
  { id: 'clothes', label: 'Clothes', icon: Shirt, ready: true },
  { id: 'weapons', label: 'Weapons', icon: Crosshair, ready: true },
  { id: 'animations', label: 'Animations', icon: Clapperboard, ready: true },
  { id: 'cutscenes', label: 'Cutscenes', icon: Film, ready: true },
  { id: 'audio', label: 'Audio', icon: Music, ready: true },
  { id: 'text', label: 'Text', icon: Languages, ready: true },
  { id: 'map', label: 'Map', icon: MapIcon, ready: true },
  { id: 'interiors', label: 'Interiors', icon: DoorOpen, ready: true },
];

/** The explorer, then the catalogs built from the game data: one tab each. */
export function SectionTabs({ current, onSelect }: { current: Section; onSelect: (section: Section) => void }) {
  return (
    <nav aria-label="Sections" className="flex h-8 shrink-0 items-end gap-1 border-b border-border px-2">
      {sections.map(({ id, label, icon: Icon, ready }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={current === id}
          disabled={!ready}
          title={ready ? undefined : 'Coming next'}
          onClick={() => onSelect(id)}
          className={`relative inline-flex h-7 items-center gap-1.5 rounded-t-md px-3 text-xs transition-colors disabled:opacity-35 ${
            current === id ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="size-3.5" />
          {label}
          {current === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-gradient" />}
        </button>
      ))}
    </nav>
  );
}
