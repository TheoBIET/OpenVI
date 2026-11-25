import { Clapperboard, Film, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { type Cutscene, cutsceneList, cutscenePreview, type SceneMember } from '../lib/cutscenes';
import { LoadingPanel } from './LoadingPanel';
import { ModelView, ModelViewSkeleton } from './ModelView';

type Loaded<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; error: string };

/** Most scenes listed at once: the filter box narrows the rest. */
const SHOWN = 600;

/** The story's cutscenes, the cast and props of the one picked, and a cast member playing it in 3D. */
export function CutscenesView({ root, filter }: { root: string; filter: string }) {
  const [scenes, setScenes] = useState<Loaded<Cutscene[]>>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [scene, setScene] = useState<Cutscene | null>(null);
  const [actor, setActor] = useState<SceneMember | null>(null);
  const [glb, setGlb] = useState<Loaded<string>>({ state: 'idle' });
  /** The last performance assembled: it stays on screen while the next one is. */
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    cutsceneList(root).then(
      (value) => current && setScenes({ state: 'ready', value }),
      (error: unknown) => current && setScenes({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  useEffect(() => {
    if (!scene || !actor) return;
    let current = true;
    setGlb({ state: 'loading' });
    cutscenePreview(root, scene.name, actor.handle).then(
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
  }, [root, scene, actor]);

  const matching = useMemo(() => {
    if (scenes.state !== 'ready') return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return scenes.value;
    return scenes.value.filter(
      (item) =>
        item.name.includes(needle) ||
        item.cast.some((member) => member.handle.includes(needle) || (member.model?.includes(needle) ?? false)),
    );
  }, [scenes, filter]);

  if (scenes.state === 'loading' || scenes.state === 'idle') {
    return (
      <LoadingPanel
        icon={Film}
        title="Finding the cutscenes"
        note="The first time scans the story pack and reads every scene (a few minutes); then it is cached."
        step={progress}
      />
    );
  }
  if (scenes.state === 'failed') {
    return (
      <p className="grid min-w-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">
        {scenes.error}
      </p>
    );
  }

  const title = scene && actor ? `${actor.handle} · ${scene.name}` : '';
  return (
    <div className="flex min-w-0 flex-1 text-xs">
      <aside aria-label="Cutscenes" className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
        <header className="border-b border-border px-3 py-2 text-muted-foreground">
          <span className="font-title text-foreground">Cutscenes</span>{' '}
          {matching.length === scenes.value.length
            ? scenes.value.length.toLocaleString('en-US')
            : `${matching.length} of ${scenes.value.length}`}
          {matching.length > SHOWN && ` · first ${SHOWN} shown`}
        </header>
        <div className="flex-1 overflow-auto">
          {matching.slice(0, SHOWN).map((item) => (
            <button
              key={item.name}
              type="button"
              title={item.name}
              onClick={() => {
                setScene(item);
                setActor(null);
              }}
              className={`flex h-6 w-full items-center gap-2 px-3 text-left ${
                scene?.name === item.name ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
            >
              <span className="truncate font-mono">{item.name}</span>
              <span className="ml-auto shrink-0 font-mono text-muted-foreground tabular-nums">{item.cast.length}</span>
            </button>
          ))}
        </div>
      </aside>
      <aside aria-label="Scene" className="flex w-72 shrink-0 flex-col overflow-auto border-r border-border bg-card">
        {!scene && <p className="px-3 py-2 text-muted-foreground">Pick a scene.</p>}
        {scene && (
          <>
            <header className="border-b border-border px-3 py-2">
              <h2 className="truncate font-title text-foreground" title={scene.name}>
                {scene.name}
              </h2>
              <p className="text-muted-foreground">
                {scene.sections} cuts · {scene.cameras} cameras
                {scene.variantOf && ` · variant of ${scene.variantOf}`}
              </p>
              {scene.missing > 0 && (
                <p className="text-warning">
                  {scene.missing} animation pieces missing from the pack: parts of the scene will not move.
                </p>
              )}
            </header>
            <section className="border-b border-border px-3 py-2">
              <h3 className="font-title text-accent-solid">Cast</h3>
              {scene.cast.length === 0 && <p className="text-muted-foreground">None.</p>}
              {scene.cast.map((member) => (
                <button
                  key={member.handle}
                  type="button"
                  disabled={member.kind !== 'character' || member.clips.length === 0}
                  onClick={() => setActor(member)}
                  title={member.kind === 'character' ? 'Play the scene on this character' : 'Not assembled by OpenVI'}
                  className={`flex h-6 w-full items-center gap-2 rounded-sm px-1 text-left disabled:opacity-50 ${
                    actor?.handle === member.handle ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
                  }`}
                >
                  <Play className="size-3 shrink-0 text-primary" />
                  <span className="truncate">{member.handle}</span>
                  <span className="ml-auto truncate font-mono text-muted-foreground">
                    {member.model ?? member.kind}
                  </span>
                </button>
              ))}
            </section>
            {scene.props.length > 0 && (
              <section className="border-b border-border px-3 py-2">
                <h3 className="font-title text-accent-solid">Props</h3>
                {scene.props.map((member) => (
                  <p key={member.handle} className="truncate font-mono text-muted-foreground" title={member.handle}>
                    {member.model ?? member.handle}
                  </p>
                ))}
              </section>
            )}
            {scene.setModels.length > 0 && (
              <section className="px-3 py-2">
                <h3 className="font-title text-accent-solid">Set</h3>
                {scene.setModels.map((model) => (
                  <p key={model} className="truncate font-mono text-muted-foreground">
                    {model}
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {shown && (
          <ModelView
            path={shown}
            title={title}
            busy={glb.state === 'loading' ? `Assembling ${actor?.handle ?? ''}…` : null}
            banner={glb.state === 'failed' ? glb.error : null}
          />
        )}
        {!shown && glb.state !== 'idle' && (
          <ModelViewSkeleton
            title={title}
            label={`Assembling ${actor?.handle ?? ''} with the whole scene…`}
            error={glb.state === 'failed' ? glb.error : null}
          />
        )}
        {!shown && glb.state === 'idle' && (
          <p className="grid flex-1 place-items-center px-10 text-center text-muted-foreground">
            <span>
              <Clapperboard className="mx-auto mb-2 size-6 text-primary" />
              Pick a scene, then a character of its cast to see them play it.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
