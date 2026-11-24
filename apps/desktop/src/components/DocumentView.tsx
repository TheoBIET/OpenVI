import { Maximize2, Minimize2, WrapText, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { fileImage, filePreview, resourceImage } from '../lib/document';
import { formatSize } from '../lib/format';
import type { Entry } from '../lib/fs';
import { modelPreview } from '../lib/model';
import { canPrettify, languageOf, prettify } from '../lib/prettify';
import { textPreview } from '../lib/resource';
import { CodeView } from './CodeView';
import { ModelView } from './ModelView';

type Content =
  | { type: 'text'; text: string; truncated: boolean }
  | { type: 'image'; url: string }
  | { type: 'model'; path: string }
  | { type: 'none'; message: string };

type Loaded = { state: 'loading' } | { state: 'ready'; content: Content } | { state: 'failed'; error: string };

/** Resource types the document view shows as text, and as 3D models. */
export const TEXT_TYPES: ReadonlySet<string> = new Set(['XML Document', 'Text']);
export const MODEL_TYPES: ReadonlySet<string> = new Set(['Drawable', 'Fragment', 'Drawable Dictionary']);

/** Whether {@link DocumentView} can open `entry`. */
export function isViewable(entry: Entry): boolean {
  if (entry.kind === 'file') return true;
  const type = entry.typeName ?? '';
  return entry.kind === 'resource' && (TEXT_TYPES.has(type) || MODEL_TYPES.has(type) || type === 'PNG Image');
}

async function load(root: string, entry: Entry): Promise<Content> {
  if (entry.kind === 'resource') {
    if (entry.typeName === 'PNG Image') return { type: 'image', url: await resourceImage(root, entry.path) };
    if (MODEL_TYPES.has(entry.typeName ?? '')) return { type: 'model', path: await modelPreview(root, entry.path) };
    const preview = await textPreview(root, entry.path);
    return { type: 'text', ...preview };
  }
  const preview = await filePreview(root, entry.path);
  if (preview.kind === 'text') return { type: 'text', text: preview.text, truncated: preview.truncated };
  if (preview.kind === 'image') return { type: 'image', url: await fileImage(root, entry.path, preview.mime) };
  return {
    type: 'none',
    message: `${entry.name} is binary data (${formatSize(entry.size)}); there is no viewer for it yet.`,
  };
}

/** A file or a resource opened in place of the list: text in Monaco, images on a checkerboard, models in 3D. */
export function DocumentView({ root, entry }: { root: string; entry: Entry }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [wrap, setWrap] = useState(false);
  const [pretty, setPretty] = useState(false);
  const [prettifyError, setPrettifyError] = useState<string | null>(null);
  const [actualSize, setActualSize] = useState(false);

  useEffect(() => {
    let current = true;
    let url: string | null = null;
    setLoaded({ state: 'loading' });
    setPretty(false);
    setPrettifyError(null);
    load(root, entry).then(
      (content) => {
        if (content.type === 'image') url = content.url;
        if (current) setLoaded({ state: 'ready', content });
        else if (url) URL.revokeObjectURL(url);
      },
      (error: unknown) => current && setLoaded({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [root, entry.path]);

  const text = loaded.state === 'ready' && loaded.content.type === 'text' ? loaded.content : null;
  const language = useMemo(() => (text ? languageOf(entry.name, text.text) : 'plaintext'), [text, entry.name]);
  const shown = useMemo(() => {
    if (!text || !pretty) return text?.text ?? '';
    try {
      return prettify(text.text, language);
    } catch {
      return text.text;
    }
  }, [text, pretty, language]);

  if (loaded.state === 'ready' && loaded.content.type === 'model') {
    return <ModelView path={loaded.content.path} title={entry.name} />;
  }

  function togglePretty() {
    if (!text) return;
    if (!pretty) {
      try {
        prettify(text.text, language);
        setPrettifyError(null);
      } catch (error) {
        setPrettifyError(`Cannot format: ${String(error)}`);
        return;
      }
    }
    setPretty(!pretty);
  }

  return (
    <main aria-label={entry.name} className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs text-muted-foreground">
        <span className="truncate text-foreground">{entry.name}</span>
        {text && (
          <>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">{language}</span>
            <span className="font-mono tabular-nums">{text.text.split('\n').length.toLocaleString('en-US')} lines</span>
            {text.truncated && <span className="text-warning">first 8 MB only</span>}
            {prettifyError && <span className="truncate text-destructive">{prettifyError}</span>}
            <span className="ml-auto flex items-center gap-1">
              {canPrettify(language) && (
                <ViewButton icon={Wand2} label="Format" active={pretty} onClick={togglePretty} />
              )}
              <ViewButton icon={WrapText} label="Wrap" active={wrap} onClick={() => setWrap(!wrap)} />
            </span>
          </>
        )}
        {loaded.state === 'ready' && loaded.content.type === 'image' && (
          <span className="ml-auto">
            <ViewButton
              icon={actualSize ? Minimize2 : Maximize2}
              label={actualSize ? 'Fit' : 'Actual size'}
              active={actualSize}
              onClick={() => setActualSize(!actualSize)}
            />
          </span>
        )}
      </div>
      {loaded.state === 'loading' && (
        <p className="grid flex-1 place-items-center text-xs text-muted-foreground">Reading…</p>
      )}
      {loaded.state === 'failed' && (
        <p className="grid flex-1 place-items-center px-10 text-center text-xs text-destructive">{loaded.error}</p>
      )}
      {text && <CodeView value={shown} language={language} wrap={wrap} />}
      {loaded.state === 'ready' && loaded.content.type === 'image' && (
        <div className="checkerboard min-h-0 flex-1 overflow-auto">
          <div className={`grid min-h-full place-items-center p-4 ${actualSize ? '' : 'h-full'}`}>
            <img
              src={loaded.content.url}
              alt={entry.name}
              className={actualSize ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
              style={{ imageRendering: actualSize ? 'pixelated' : 'auto' }}
            />
          </div>
        </div>
      )}
      {loaded.state === 'ready' && loaded.content.type === 'none' && (
        <p className="grid flex-1 place-items-center px-10 text-center text-xs text-muted-foreground">
          {loaded.content.message}
        </p>
      )}
    </main>
  );
}

function ViewButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Wand2;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1 rounded-sm px-1.5 ${
        active ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-muted'
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
