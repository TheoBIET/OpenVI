import { type RefObject, useEffect, useRef, useState } from 'react';

import type { ModelStats, RenderMode, SceneHandle } from '../lib/scene';

/** One mounted scene: its own layer in the stage, so a new one can load under it. */
type Layer = { element: HTMLDivElement; handle: SceneHandle };

const FADE_MS = 250;

function dispose(layer: Layer | null) {
  if (!layer) return;
  layer.handle.dispose();
  layer.element.remove();
}

/**
 * Shows the GLB at `path` in the `stage` element, double-buffered: a new path loads in a hidden layer while the
 * current model stays on screen, then fades in over it and the old one goes. `loading` is true while a model is
 * on its way (the first one, or a replacement); `stats` and `handle` are the shown model's.
 */
export function useBufferedScene(
  stage: RefObject<HTMLDivElement | null>,
  path: string | null,
  options: { autoRotate?: boolean; mode?: RenderMode } = {},
): { handle: SceneHandle | null; stats: ModelStats | null; error: string | null; loading: boolean } {
  const shown = useRef<Layer | null>(null);
  const [handle, setHandle] = useState<SceneHandle | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mode = useRef(options.mode);
  mode.current = options.mode;
  const autoRotate = options.autoRotate === true;

  useEffect(() => {
    if (!path) return;
    let incoming: Layer | null = null;
    let settled = false;
    setLoading(true);
    setError(null);
    void import('../lib/scene').then(({ mountScene }) => {
      const host = stage.current;
      if (settled || !host) return;
      const element = document.createElement('div');
      element.className = 'absolute inset-0 opacity-0 transition-opacity';
      element.style.transitionDuration = `${FADE_MS}ms`;
      host.appendChild(element);
      const handle = mountScene(
        element,
        path,
        (ready) => {
          if (settled || !incoming) return;
          settled = true;
          const previous = shown.current;
          shown.current = incoming;
          element.style.opacity = '1';
          // The old model leaves once the new one has faded in over it.
          setTimeout(() => dispose(previous), FADE_MS);
          setHandle(incoming.handle);
          setStats(ready);
          setLoading(false);
        },
        (failure) => {
          if (settled) return;
          settled = true;
          // The model on screen stays; the failed one goes.
          dispose(incoming);
          incoming = null;
          setError(`Cannot show this model: ${String(failure)}`);
          setLoading(false);
        },
        { autoRotate },
      );
      if (mode.current) handle.setMode(mode.current);
      incoming = { element, handle };
    });
    return () => {
      // A newer path superseded this one before it was ready.
      if (!settled) {
        settled = true;
        dispose(incoming);
      }
    };
  }, [stage, path, autoRotate]);

  // The shown model goes with the view.
  useEffect(
    () => () => {
      dispose(shown.current);
      shown.current = null;
    },
    [],
  );

  return { handle, stats, error, loading };
}
