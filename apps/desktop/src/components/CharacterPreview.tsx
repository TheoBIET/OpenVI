import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type Character, type CharacterPart, characterParts, characterPreview } from '../lib/characters';
import { ModelView } from './ModelView';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: string };

/** One character assembled in 3D, with the parts it wears: one per group, or none, picked in the side panel. */
export function CharacterPreview({ root, character }: { root: string; character: Character }) {
  const [parts, setParts] = useState<Loaded<CharacterPart[]>>({ state: 'loading' });
  /** Offset worn in each group; a group left out wears nothing. Null until the parts are known. */
  const [worn, setWorn] = useState<Record<string, number> | null>(null);
  const [glb, setGlb] = useState<Loaded<string>>({ state: 'loading' });
  /** The look on show: assembling takes seconds, so the panel's choices apply on demand. */
  const [applied, setApplied] = useState<number[] | null>(null);

  useEffect(() => {
    let current = true;
    setParts({ state: 'loading' });
    setWorn(null);
    setApplied(null);
    characterParts(root, character.name).then(
      (list) => {
        if (!current) return;
        setParts({ state: 'ready', value: list });
        const defaults = list.filter((part) => part.default);
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
      (path) => current && setGlb({ state: 'ready', value: path }),
      (error: unknown) => current && setGlb({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, character.name, applied]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, CharacterPart[]>();
    for (const part of parts.state === 'ready' ? parts.value : []) {
      byGroup.set(part.group, [...(byGroup.get(part.group) ?? []), part]);
    }
    return [...byGroup];
  }, [parts]);

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
    setWorn(Object.fromEntries(parts.value.filter((p) => p.default).map((p) => [p.group, p.offset])));
  }

  return (
    <div className="flex min-w-0 flex-1">
      {glb.state === 'ready' ? (
        <ModelView path={glb.value} title={character.name} />
      ) : (
        <p
          className={`grid min-w-0 flex-1 place-items-center px-10 text-center text-xs ${
            glb.state === 'failed' || parts.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {parts.state === 'failed' && parts.error}
          {parts.state !== 'failed' && glb.state === 'failed' && glb.error}
          {parts.state !== 'failed' && glb.state === 'loading' && `Assembling ${character.name}…`}
        </p>
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
