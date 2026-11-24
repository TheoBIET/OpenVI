import { Clapperboard } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type Clip, type ClipDictionary, animationClips, animationDictionaries } from '../lib/animations';
import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Character, characterList, characterPreview } from '../lib/characters';
import { LoadingPanel } from './LoadingPanel';
import { ModelView, ModelViewSkeleton } from './ModelView';

type Loaded<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; error: string };

/** Most dictionaries listed at once: the filter box narrows the rest. */
const SHOWN = 400;

/** The character a dictionary's clips most likely fit, from its name (female, male, an animal), else the first one. */
function guessCharacter(dictionary: string, characters: Character[]): string | undefined {
  const name = dictionary.toLowerCase();
  // Animals are named <prefix>_<species>_... (`crb_deer_whitetailed_m_00`).
  const animal = characters.find((c) => {
    const species = c.name.split('_')[1];
    return c.kind === 'animal' && species !== undefined && name.includes(species);
  });
  if (animal) return animal.name;
  const humans = characters.filter((c) => c.kind === 'character');
  const sex = name.includes('female') ? 'f' : 'm';
  const story = humans.find(
    (c) => c.name.startsWith('player_story') && (sex === 'f' ? c.name.endsWith('_00') : c.name.endsWith('_01')),
  );
  return story?.name ?? humans[0]?.name ?? characters[0]?.name;
}

/** Clip dictionaries, their clips, and the chosen clip played on a character (or its skeleton alone). */
export function AnimationsView({ root, filter }: { root: string; filter: string }) {
  const [dictionaries, setDictionaries] = useState<Loaded<ClipDictionary[]>>({ state: 'loading' });
  const [characters, setCharacters] = useState<Character[]>([]);
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [dictionary, setDictionary] = useState<string | null>(null);
  const [clips, setClips] = useState<Loaded<Clip[]>>({ state: 'idle' });
  const [clip, setClip] = useState<string | null>(null);
  const [character, setCharacter] = useState<string | null>(null);
  const [skeletonOnly, setSkeletonOnly] = useState(false);
  const [glb, setGlb] = useState<Loaded<string>>({ state: 'idle' });
  /** The clip exported on its own (skeleton and animation). */
  const [clipGlb, setClipGlb] = useState<Loaded<string>>({ state: 'idle' });
  /** The last clip assembled: it stays on screen while the next one is. */
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    animationDictionaries(root).then(
      (value) => current && setDictionaries({ state: 'ready', value }),
      (error: unknown) => current && setDictionaries({ state: 'failed', error: String(error) }),
    );
    // Characters to play clips on; without packs.rpf the clips still list.
    characterList(root).then(
      (value) => current && setCharacters(value),
      () => undefined,
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  useEffect(() => {
    if (!dictionary) return;
    let current = true;
    setClips({ state: 'loading' });
    setClip(null);
    setCharacter((previous) => previous ?? guessCharacter(dictionary, characters) ?? null);
    animationClips(root, dictionary).then(
      (value) => {
        if (!current) return;
        setClips({ state: 'ready', value });
        setClip(value[0]?.name ?? null);
      },
      (error: unknown) => current && setClips({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, dictionary, characters]);

  // The character is assembled once per character (its default look, without animation)…
  useEffect(() => {
    if (!character || !dictionary) return;
    let current = true;
    setGlb({ state: 'loading' });
    characterPreview(root, character, null).then(
      (value) => {
        if (!current) return;
        setGlb({ state: 'ready', value });
        setShown(value);
      },
      (error: unknown) => current && setGlb({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, character, dictionary === null]);

  // …and each clip is exported on its own (skeleton and animation, no meshes or textures), then played on it.
  useEffect(() => {
    if (!dictionary || !clip || !character) return;
    let current = true;
    setClipGlb({ state: 'loading' });
    characterPreview(root, character, null, { dictionary, clip, skeletonOnly: true }).then(
      (value) => current && setClipGlb({ state: 'ready', value }),
      (error: unknown) => current && setClipGlb({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, dictionary, clip, character]);

  const matching = useMemo(() => {
    if (dictionaries.state !== 'ready') return [];
    const needle = filter.trim().toLowerCase();
    return needle ? dictionaries.value.filter((d) => d.name.toLowerCase().includes(needle)) : dictionaries.value;
  }, [dictionaries, filter]);

  if (dictionaries.state === 'loading' || dictionaries.state === 'idle') {
    return (
      <LoadingPanel
        icon={Clapperboard}
        title="Listing the animations"
        note="The first time scans anim.rpf and reads each clip dictionary's name (about a minute); then it is cached."
        step={progress}
      />
    );
  }
  if (dictionaries.state === 'failed') {
    return (
      <p className="grid min-w-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">
        {dictionaries.error}
      </p>
    );
  }

  const clipList = clips.state === 'ready' ? clips.value : [];
  // What the 3D view says over the character: assembling it, or exporting the clip it is about to play.
  let busyLabel: string | null = null;
  if (glb.state === 'loading') busyLabel = `Assembling ${character ?? ''}…`;
  else if (clipGlb.state === 'loading') busyLabel = `Exporting ${clip ?? ''}…`;
  let problem: string | null = null;
  if (glb.state === 'failed') problem = glb.error;
  else if (clipGlb.state === 'failed') problem = clipGlb.error;
  const assembling = `Assembling ${character ?? ''} with ${clip ?? ''}…`;
  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label="Clip dictionaries"
        className="flex w-80 shrink-0 flex-col border-r border-border bg-card text-xs"
      >
        <header className="border-b border-border px-3 py-2 text-muted-foreground">
          <span className="font-title text-foreground">Dictionaries</span>{' '}
          {matching.length === dictionaries.value.length
            ? dictionaries.value.length.toLocaleString('en-US')
            : `${matching.length.toLocaleString('en-US')} of ${dictionaries.value.length.toLocaleString('en-US')}`}
          {matching.length > SHOWN && ` · first ${SHOWN} shown, type in the filter to narrow`}
        </header>
        <div className="flex-1 overflow-auto">
          {matching.slice(0, SHOWN).map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.name}
              onClick={() => setDictionary(item.name)}
              className={`block h-6 w-full truncate px-3 text-left font-mono ${
                dictionary === item.name ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </aside>
      <aside aria-label="Clips" className="flex w-56 shrink-0 flex-col border-r border-border bg-card text-xs">
        <header className="border-b border-border px-3 py-2 font-title text-foreground">Clips</header>
        <div className="flex-1 overflow-auto">
          {!dictionary && <p className="px-3 py-2 text-muted-foreground">Pick a dictionary.</p>}
          {clips.state === 'loading' && <p className="px-3 py-2 text-muted-foreground">Reading…</p>}
          {clips.state === 'failed' && <p className="px-3 py-2 text-destructive">{clips.error}</p>}
          {clipList.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => setClip(item.name)}
              className={`flex h-6 w-full items-center gap-2 px-3 text-left ${
                clip === item.name ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
            >
              <span className="truncate font-mono">{item.name}</span>
              <span className="ml-auto shrink-0 font-mono text-muted-foreground tabular-nums">
                {item.duration.toFixed(2)} s
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            Played on
            <select
              aria-label="Character"
              value={character ?? ''}
              onChange={(event) => setCharacter(event.target.value || null)}
              className="h-6 max-w-64 rounded-sm border border-border bg-background px-1 font-mono text-foreground"
            >
              {characters.length === 0 && <option value="">no characters (packs.rpf)</option>}
              {characters.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={skeletonOnly}
              onChange={(event) => setSkeletonOnly(event.target.checked)}
              className="accent-primary"
            />
            Skeleton only
          </label>
        </div>
        {/* The clip on screen keeps playing (blurred) while the next one is assembled. */}
        {/* The character stays (blurred) while another is assembled; a new clip only swaps its animation. */}
        {shown && !skeletonOnly && (
          <ModelView
            path={shown}
            title={`${dictionary ?? ''}/${clip ?? ''}`}
            animation={clipGlb.state === 'ready' ? clipGlb.value : null}
            busy={busyLabel}
            banner={problem}
          />
        )}
        {/* The skeleton alone: the clip's own GLB, its bones drawn. */}
        {skeletonOnly && clipGlb.state === 'ready' && (
          <ModelView path={clipGlb.value} title={`${dictionary ?? ''}/${clip ?? ''} · skeleton`} />
        )}
        {skeletonOnly && clipGlb.state !== 'ready' && clipGlb.state !== 'idle' && (
          <ModelViewSkeleton
            title={`${dictionary ?? ''}/${clip ?? ''} · skeleton`}
            label={`Exporting ${clip ?? ''}…`}
            error={clipGlb.state === 'failed' ? clipGlb.error : null}
          />
        )}
        {!shown && !skeletonOnly && glb.state === 'idle' && (
          <p className="grid flex-1 place-items-center px-10 text-center text-xs text-muted-foreground">
            Pick a dictionary and a clip to play it on a character.
          </p>
        )}
        {!shown && !skeletonOnly && glb.state !== 'idle' && (
          <ModelViewSkeleton
            title={`${dictionary ?? ''}/${clip ?? ''}`}
            label={assembling}
            error={glb.state === 'failed' ? glb.error : null}
          />
        )}
      </div>
    </div>
  );
}
