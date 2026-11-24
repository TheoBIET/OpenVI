import { Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Character, characterList, characterPreview } from '../lib/characters';
import { formatSize } from '../lib/format';
import { listKeys, ModelPreview, PreviewPane, PreviewSection, Properties, useSettled } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; characters: Character[] } | { state: 'failed'; error: string };

type Kind = 'all' | Character['kind'];

const kinds: Kind[] = ['all', 'character', 'animal'];

const grid = { gridTemplateColumns: 'minmax(12rem,1fr) 7rem 5rem 7rem' };

/** Every character and animal; the filter box narrows the list, double-click opens one in 3D. */
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
      (character) => (kind === 'all' || character.kind === kind) && character.name.includes(needle),
    );
  }, [loaded, filter, kind]);

  if (loaded.state === 'loading') {
    const ratio = progress && progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 0;
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center p-10" aria-busy="true">
        <div className="flex w-80 flex-col items-center text-center">
          <Users className="mb-3 size-8 text-primary" />
          <h2 className="font-title text-foreground">Finding the characters</h2>
          <p className="mt-1 text-xs text-muted-foreground">The first time scans packs.rpf, where their parts are.</p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-accent-gradient" style={{ width: `${ratio * 100}%` }} />
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
            {progress
              ? `${progress.archive} · ${progress.phase === 'carving' ? `finding resources ${formatSize(progress.done)}` : `reading names ${progress.done}`}`
              : 'Reading…'}
          </p>
        </div>
      </main>
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
            {all.filter((c) => c.kind === 'animal').length} animals
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
          </select>
        </div>
        <div
          className="grid h-7 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground"
          style={grid}
        >
          <span>Name</span>
          <span>Kind</span>
          <span className="text-right">Parts</span>
          <span className="text-right">Worn by default</span>
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
              <span className="truncate font-mono text-xs">{character.name}</span>
              <span className="text-muted-foreground">{character.kind}</span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{character.parts}</span>
              <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                {character.defaultParts}
              </span>
            </div>
          ))}
        </div>
      </main>
      {selected && <CharacterPane root={root} character={selected} onOpen={() => onOpen(selected)} />}
    </div>
  );
}

/** The selected character or animal: its default look turning in 3D. */
function CharacterPane({ root, character, onOpen }: { root: string; character: Character; onOpen: () => void }) {
  const glb = useSettled(character.name, () => characterPreview(root, character.name, null), 400);
  return (
    <PreviewPane title={character.name} subtitle={character.kind} onOpen={onOpen}>
      <PreviewSection>
        <ModelPreview loaded={glb} waiting="Assembling its default look…" />
      </PreviewSection>
      <PreviewSection>
        <Properties
          rows={[
            ['Kind', character.kind],
            ['Parts', character.parts],
            ['Worn by default', character.defaultParts],
          ]}
        />
        <p className="mt-2 text-muted-foreground">Open it to change its parts.</p>
      </PreviewSection>
    </PreviewPane>
  );
}
