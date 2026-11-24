import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type Weapon, type WeaponAssembly, type WeaponPart, weaponParts, weaponPreview } from '../lib/weapons';
import { ModelView, ModelViewSkeleton } from './ModelView';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: string };

/** One weapon built in 3D from its parts: one per slot, or none, picked in the side panel. */
export function WeaponPreview({ root, weapon }: { root: string; weapon: Weapon }) {
  const [parts, setParts] = useState<Loaded<WeaponPart[]>>({ state: 'loading' });
  /** Offset fitted in each slot; a slot left out stays empty. Null until the parts are known. */
  const [fitted, setFitted] = useState<Record<string, number> | null>(null);
  const [built, setBuilt] = useState<Loaded<WeaponAssembly>>({ state: 'loading' });
  /** The last build: it stays on screen while the next one is made. */
  const [shown, setShown] = useState<string | null>(null);
  /** The build on show: each part is exported the first time, so changes apply on demand. */
  const [applied, setApplied] = useState<number[] | null>(null);

  useEffect(() => {
    let current = true;
    setParts({ state: 'loading' });
    setFitted(null);
    setApplied(null);
    setShown(null);
    weaponParts(root, weapon.name).then(
      (list) => {
        if (!current) return;
        setParts({ state: 'ready', value: list });
        const defaults = list.filter((part) => part.default);
        setFitted(Object.fromEntries(defaults.map((part) => [part.group, part.offset])));
        setApplied(defaults.map((part) => part.offset).sort((a, b) => a - b));
      },
      (error: unknown) => current && setParts({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, weapon.name]);

  useEffect(() => {
    if (!applied) return;
    let current = true;
    setBuilt({ state: 'loading' });
    weaponPreview(root, weapon.name, applied).then(
      (assembly) => {
        if (!current) return;
        setBuilt({ state: 'ready', value: assembly });
        setShown(assembly.manifest);
      },
      (error: unknown) => current && setBuilt({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, weapon.name, applied]);

  const chosen = useMemo(() => (fitted ? Object.values(fitted).sort((a, b) => a - b) : null), [fitted]);
  const changed = chosen !== null && applied !== null && chosen.join() !== applied.join();

  const groups = useMemo(() => {
    const bySlot = new Map<string, WeaponPart[]>();
    for (const part of parts.state === 'ready' ? parts.value : []) {
      bySlot.set(part.group, [...(bySlot.get(part.group) ?? []), part]);
    }
    return [...bySlot];
  }, [parts]);

  function fit(group: string, offset: number | null) {
    setFitted((previous) => {
      const next = { ...previous };
      if (offset === null) delete next[group];
      else next[group] = offset;
      return next;
    });
  }

  function reset() {
    if (parts.state !== 'ready') return;
    setFitted(Object.fromEntries(parts.value.filter((p) => p.default).map((p) => [p.group, p.offset])));
  }

  let failure: string | null = null;
  if (parts.state === 'failed') failure = parts.error;
  else if (built.state === 'failed') failure = built.error;
  let notice: string | null = null;
  if (built.state === 'failed') notice = built.error;
  else if (built.state === 'ready' && built.value.unmounted.length > 0) {
    notice = `No mount for ${built.value.unmounted.join(', ')}: left out.`;
  }

  return (
    <div className="flex min-w-0 flex-1">
      {shown ? (
        <ModelView
          path={shown}
          title={weapon.name}
          busy={built.state === 'loading' ? `Building ${weapon.name}…` : null}
          banner={notice}
        />
      ) : (
        <ModelViewSkeleton title={weapon.name} label={`Building ${weapon.name} from its parts…`} error={failure} />
      )}
      <aside aria-label="Parts" className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
          <h2 className="font-title text-foreground">Parts</h2>
          <span className="text-muted-foreground">{chosen?.length ?? 0} fitted</span>
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
          {parts.state === 'ready' && parts.value.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">No parts: the model is shown as it is.</p>
          )}
          {groups.map(([group, options]) => (
            <fieldset key={group} className="border-b border-border px-3 py-2">
              <legend className="font-title text-accent-solid">{group}</legend>
              <label className="flex h-6 items-center gap-2 text-muted-foreground">
                <input
                  type="radio"
                  name={group}
                  checked={fitted?.[group] === undefined}
                  onChange={() => fit(group, null)}
                  className="accent-primary"
                />
                none
              </label>
              {options.map((part) => (
                <label key={part.offset} className="flex h-6 items-center gap-2" title={part.name}>
                  <input
                    type="radio"
                    name={group}
                    checked={fitted?.[group] === part.offset}
                    onChange={() => fit(group, part.offset)}
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
