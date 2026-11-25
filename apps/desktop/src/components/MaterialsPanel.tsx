import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';

import { type MaterialReport, modelMaterials } from '../lib/model';
import type { SceneHandle } from '../lib/scene';

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; materials: MaterialReport[] }
  | { state: 'failed'; error: string };

const MISSING = 'not in any ttpf store';

/**
 * The materials of an exported model: each texture with its role, its status (why it is missing) and a thumbnail,
 * from the description SixNG writes beside a model exported on its own. Characters, vehicles and assemblies have no
 * such description (`glb` null for an assembly): their materials are read from the model on screen (`handle`).
 */
export function MaterialsPanel({ glb, handle }: { glb: string | null; handle: SceneHandle | null }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const onScreen = useMemo(() => handle?.materials() ?? [], [handle]);

  useEffect(() => {
    if (glb === null) {
      setLoaded({ state: 'ready', materials: [] });
      return;
    }
    let current = true;
    setLoaded({ state: 'loading' });
    modelMaterials(glb).then(
      (materials) => current && setLoaded({ state: 'ready', materials }),
      (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [glb]);

  const materials = loaded.state === 'ready' ? loaded.materials : [];
  const slots = materials.flatMap((material) => material.textures);
  const missing = slots.filter((slot) => slot.status === MISSING).length;

  return (
    <aside
      aria-label="Materials"
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-card"
    >
      <header className="border-b border-border px-3 py-2 text-xs">
        <h2 className="font-title text-foreground">Materials</h2>
        {loaded.state === 'ready' && materials.length === 0 && (
          <p className="text-muted-foreground">
            {onScreen.length} materials · {onScreen.reduce((sum, material) => sum + material.textures.length, 0)}{' '}
            textures, read from the model
          </p>
        )}
        {loaded.state === 'ready' && materials.length > 0 && (
          <p className="text-muted-foreground">
            {materials.length} materials · {slots.length} textures
            {missing > 0 && <span className="text-warning"> · {missing} not found</span>}
          </p>
        )}
      </header>
      <div className="flex-1 overflow-auto text-xs">
        {loaded.state === 'loading' && <p className="px-3 py-2 text-muted-foreground">Reading…</p>}
        {loaded.state === 'failed' && <p className="px-3 py-2 text-destructive">{loaded.error}</p>}
        {loaded.state === 'ready' && materials.length === 0 && onScreen.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground">This model has no materials.</p>
        )}
        {loaded.state === 'ready' &&
          materials.length === 0 &&
          onScreen.map((material, index) => (
            <section key={material.name + String(index)} className="border-b border-border px-3 py-2">
              <h3 className="truncate font-title text-accent-solid" title={material.name}>
                {index + 1}. {material.name}
                <span className="ml-1 font-sans text-muted-foreground">
                  ({material.meshes} {material.meshes === 1 ? 'mesh' : 'meshes'})
                </span>
              </h3>
              {material.textures.length === 0 && <p className="text-muted-foreground">No textures (a flat colour).</p>}
              <ul className="mt-1 space-y-1.5">
                {material.textures.map((texture) => (
                  <li key={texture.slot} className="flex items-center gap-2">
                    <span className="checkerboard grid size-10 shrink-0 place-items-center overflow-hidden rounded-sm border border-border">
                      {texture.thumbnail && (
                        <img src={texture.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{texture.slot}</span>
                      {texture.width > 0 && (
                        <span className="block truncate font-mono text-muted-foreground">
                          {texture.width}×{texture.height}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {missing > 0 && (
          <p className="border-b border-border px-3 py-2 text-warning">
            “{MISSING}”: the texture store holding it (`data/ttdb`, or a pack&apos;s `data/ttdb`) is missing or still
            incomplete. Stores are opened once per run: restart OpenVI after they finish downloading.
          </p>
        )}
        {materials.map((material) => (
          <section key={material.index} className="border-b border-border px-3 py-2">
            <h3 className="truncate font-title text-accent-solid" title={material.shader}>
              {material.index + 1}. {material.shader}
              {material.class && <span className="ml-1 font-sans text-muted-foreground">({material.class})</span>}
            </h3>
            {material.textures.length === 0 && <p className="text-muted-foreground">No textures.</p>}
            <ul className="mt-1 space-y-1.5">
              {material.textures.map((slot) => (
                <li key={slot.slot} className="flex items-center gap-2">
                  <span className="checkerboard grid size-10 shrink-0 place-items-center overflow-hidden rounded-sm border border-border">
                    {slot.file && (
                      <img src={convertFileSrc(slot.file)} alt="" className="max-h-full max-w-full object-contain" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-foreground" title={slot.slot}>
                      {slot.slot}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {[slot.role, slot.width && slot.height ? `${slot.width}×${slot.height}` : null, slot.format]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span
                      className={`block truncate ${slot.status.startsWith('ok') ? 'text-muted-foreground' : 'text-warning'}`}
                      title={slot.status}
                    >
                      {slot.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
