import { Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Character, characterList, characterPreview } from '../lib/characters';
import { LoadingPanel } from './LoadingPanel';
import { listKeys, ModelPreview, PreviewPane, PreviewSection, Properties, useSettled } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; characters: Character[] } | { state: 'failed'; error: string };

type Kind = 'all' | Character['kind'];

const kinds: Kind[] = ['all', 'character', 'animal', 'model'];

/** How the list names a kind. */
export const kindLabel: Record<Character['kind'], string> = {
  character: 'character',
  animal: 'animal',
  model: 'ped model',
};

const grid = { gridTemplateColumns: 'minmax(12rem,1fr) minmax(8rem,16rem) 6rem 4rem 4rem' };

/** Every character, animal and ped model; the filter box narrows the list (by model or game name), double-click
 * opens one in 3D. */
export function CharactersView({
  root,
  filter,
  onOpen,
}: {
  root: string;
  filter: string;
  onOpen: (character: Character) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  /** The row the preview pane shows. */
  const [selected, setSelected] = useState<Character | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setLoaded({ state: 'loading' });
    characterList(root).then(
      (characters) => current && setLoaded({ state: 'ready', characters }),
      (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  const rows = useMemo(() => {
    if (loaded.state !== 'ready') return [];
    const needle = filter.trim().toLowerCase();
    return loaded.characters.filter(
      (character) =>
        (kind === 'all' || character.kind === kind) &&
        (character.name.includes(needle) || (character.display?.toLowerCase().includes(needle) ?? false)),
    );
  }, [loaded, filter, kind]);

  if (loaded.state === 'loading') {
    return (
      <LoadingPanel
        icon={Users}
        title="Finding the characters"
        note="The first time scans packs.rpf, where their parts are, and data.rpf, where their names are."
        step={progress}
      />
    );
  }
  if (loaded.state === 'failed') {
    return (
      <p className="grid min-w-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">
        {loaded.error}
      </p>
    );
  }

  const all = loaded.characters;
  return (
    <div className="flex min-w-0 flex-1">
      <main aria-label="Characters" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Characters</span>
          <span className="font-mono tabular-nums">
            {all.filter((c) => c.kind === 'character').length} characters ·{' '}
            {all.filter((c) => c.kind === 'animal').length} animals · {all.filter((c) => c.kind === 'model').length} ped
            models
          </span>
          <select
            aria-label="Kind"
            value={kind}
            onChange={(event) => setKind(kinds.find((value) => value === event.target.value) ?? 'all')}
            className="ml-auto h-6 rounded-sm border border-border bg-background px-1 text-foreground"
          >
            <option value="all">All</option>
            <option value="character">Characters</option>
            <option value="animal">Animals</option>
            <option value="model">Ped models</option>
          </select>
        </div>
        <div
          className="grid h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground"
          style={grid}
        >
          <span>Name</span>
          <span>Shown in game as</span>
          <span>Kind</span>
          <span className="text-right">Parts</span>
          <span className="text-right">Outfits</span>
        </div>
        <div
          tabIndex={0}
          aria-label="Characters list"
          onKeyDown={listKeys(rows, (row) => row.name, selected, setSelected, onOpen)}
          className="flex-1 overflow-auto outline-none"
        >
          {rows.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">No character matches.</p>}
          {rows.map((character) => (
            <div
              key={character.name}
              role="row"
              title={`Double-click to see ${character.name} in 3D`}
              data-row={character.name}
              onClick={() => setSelected(character)}
              onDoubleClick={() => onOpen(character)}
              className={`grid h-6 cursor-default items-center gap-3 px-3 ${
                selected?.name === character.name ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
              style={grid}
            >
              <span className="truncate font-mono text-xs">
                {character.name}
                {character.uncertain && (
                  <span className="text-warning" title="The name may be a chance hash match">
                    {' '}
                    ?
                  </span>
                )}
              </span>
              <span className="truncate">{character.display}</span>
              <span className="text-muted-foreground">{kindLabel[character.kind]}</span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {character.parts || ''}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {character.outfits || ''}
              </span>
            </div>
          ))}
        </div>
      </main>
      {selected && <CharacterPane root={root} character={selected} onOpen={() => onOpen(selected)} />}
    </div>
  );
}

/** The selected character, animal or ped model: its default look turning in 3D. */
function CharacterPane({ root, character, onOpen }: { root: string; character: Character; onOpen: () => void }) {
  const glb = useSettled(character.name, () => characterPreview(root, character.name, null), 400);
  return (
    <PreviewPane title={character.display ?? character.name} subtitle={kindLabel[character.kind]} onOpen={onOpen}>
      <PreviewSection>
        <ModelPreview loaded={glb} waiting="Assembling its default look…" />
      </PreviewSection>
      <PreviewSection>
        <Properties
          rows={[
            ['Name', character.name],
            ['Shown in game as', character.display ?? '—'],
            ['Kind', kindLabel[character.kind]],
            ['Parts', character.parts || '—'],
            ['Worn by default', character.defaultParts || '—'],
            ['Outfits', character.outfits || '—'],
          ]}
        />
        <p className="mt-2 text-muted-foreground">Open it to change its outfit or parts.</p>
      </PreviewSection>
    </PreviewPane>
  );
}
