import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  type Character,
  type CharacterPart,
  type CharacterParts,
  characterParts,
  characterPreview,
} from '../lib/characters';
import { ModelView, ModelViewSkeleton } from './ModelView';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: string };

/**
 * One character assembled in 3D, with the parts it wears: one per group, or none, picked in the side panel, or the
 * parts of one of the outfits the game dresses it in.
 */
export function CharacterPreview({ root, character }: { root: string; character: Character }) {
  const [parts, setParts] = useState<Loaded<CharacterParts>>({ state: 'loading' });
  /** Offset worn in each group; a group left out wears nothing. Null until the parts are known. */
  const [worn, setWorn] = useState<Record<string, number> | null>(null);
  const [glb, setGlb] = useState<Loaded<string>>({ state: 'loading' });
  /** The last look assembled: it stays on screen while the next one is. */
  const [shown, setShown] = useState<string | null>(null);
  /** The look on show: assembling takes seconds, so the panel's choices apply on demand. */
  const [applied, setApplied] = useState<number[] | null>(null);

  useEffect(() => {
    let current = true;
    setParts({ state: 'loading' });
    setWorn(null);
    setApplied(null);
    setShown(null);
    characterParts(root, character.name).then(
      (list) => {
        if (!current) return;
        setParts({ state: 'ready', value: list });
        const defaults = list.parts.filter((part) => part.default);
        setWorn(Object.fromEntries(defaults.map((part) => [part.group, part.offset])));
        setApplied(defaults.map((part) => part.offset).sort((a, b) => a - b));
      },
      (error: unknown) => current && setParts({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, character.name]);

  const chosen = useMemo(() => (worn ? Object.values(worn).sort((a, b) => a - b) : null), [worn]);
  const changed = chosen !== null && applied !== null && chosen.join() !== applied.join();

  // Assembles the chosen look; the backend keeps each look it built.
  useEffect(() => {
    if (!applied) return;
    let current = true;
    setGlb({ state: 'loading' });
    characterPreview(root, character.name, applied).then(
      (path) => {
        if (!current) return;
        setGlb({ state: 'ready', value: path });
        setShown(path);
      },
      (error: unknown) => current && setGlb({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, character.name, applied]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, CharacterPart[]>();
    for (const part of parts.state === 'ready' ? parts.value.parts : []) {
      byGroup.set(part.group, [...(byGroup.get(part.group) ?? []), part]);
    }
    return [...byGroup];
  }, [parts]);

  let failure: string | null = null;
  if (parts.state === 'failed') failure = parts.error;
  else if (glb.state === 'failed') failure = glb.error;

  function wear(group: string, offset: number | null) {
    setWorn((previous) => {
      const next = { ...previous };
      if (offset === null) delete next[group];
      else next[group] = offset;
      return next;
    });
  }

  function reset() {
    if (parts.state !== 'ready') return;
    setWorn(Object.fromEntries(parts.value.parts.filter((p) => p.default).map((p) => [p.group, p.offset])));
  }

  /** Wears outfit `index` alone, and shows it at once. */
  function dress(index: number) {
    if (parts.state !== 'ready') return;
    const outfit = parts.value.outfits[index];
    if (!outfit) return;
    const groupOf = new Map(parts.value.parts.map((part) => [part.offset, part.group]));
    const next: Record<string, number> = {};
    for (const offset of outfit.parts) {
      const group = groupOf.get(offset);
      if (group !== undefined) next[group] = offset;
    }
    setWorn(next);
    setApplied(Object.values(next).sort((a, b) => a - b));
  }

  const outfits = parts.state === 'ready' ? parts.value.outfits : [];
  const title = character.display ? `${character.display} · ${character.name}` : character.name;

  return (
    <div className="flex min-w-0 flex-1">
      {/* The look on screen stays (blurred) while the next one is assembled. */}
      {shown ? (
        <ModelView
          path={shown}
          title={title}
          busy={glb.state === 'loading' ? `Assembling ${character.name}…` : null}
          banner={glb.state === 'failed' ? glb.error : null}
        />
      ) : (
        <ModelViewSkeleton title={title} label={`Assembling ${character.name}…`} error={failure} />
      )}
      <aside aria-label="Parts" className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
          <h2 className="font-title text-foreground">Parts</h2>
          <span className="text-muted-foreground">{chosen?.length ?? 0} worn</span>
          <button
            type="button"
            disabled={!changed}
            onClick={() => setApplied(chosen)}
            className="ml-auto inline-flex h-6 items-center rounded-sm bg-accent-gradient px-2 font-semibold text-on-accent disabled:opacity-35"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
          >
            <RotateCcw className="size-3.5" />
            Default
          </button>
        </header>
        {outfits.length > 0 && (
          <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            Outfit
            <select
              aria-label="Outfit"
              value=""
              onChange={(event) => dress(Number(event.target.value))}
              className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-background px-1 text-foreground"
            >
              <option value="" disabled>
                {outfits.length} from the game…
              </option>
              {outfits.map((outfit, index) => (
                <option key={outfit.label + String(index)} value={index}>
                  {outfit.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex-1 overflow-auto text-xs">
          {parts.state === 'loading' && <p className="px-3 py-2 text-muted-foreground">Reading…</p>}
          {groups.map(([group, options]) => (
            <fieldset key={group} className="border-b border-border px-3 py-2">
              <legend className="font-title text-accent-solid">{group}</legend>
              <label className="flex h-6 items-center gap-2 text-muted-foreground">
                <input
                  type="radio"
                  name={group}
                  checked={worn?.[group] === undefined}
                  onChange={() => wear(group, null)}
                  className="accent-primary"
                />
                none
              </label>
              {options.map((part) => (
                <label key={part.offset} className="flex h-6 items-center gap-2" title={part.name}>
                  <input
                    type="radio"
                    name={group}
                    checked={worn?.[group] === part.offset}
                    onChange={() => wear(group, part.offset)}
                    className="accent-primary"
                  />
                  <span className="truncate">{part.label}</span>
                  {part.default && <span className="ml-auto shrink-0 text-muted-foreground">default</span>}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </aside>
    </div>
  );
}
