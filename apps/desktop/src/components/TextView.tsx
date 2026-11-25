import { Copy, Languages } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { gameText, type TextLine, type TextSearch } from '../lib/text';
import { LoadingPanel } from './LoadingPanel';
import { listKeys, PreviewPane, PreviewSection, Properties } from './preview';

type Loaded = { state: 'loading' } | { state: 'ready'; result: TextSearch } | { state: 'failed'; error: string };

/** Search the game's strings with the filter box; a line shows in full, markup included, in the right pane. */
export function TextView({ root, filter }: { root: string; filter: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [selected, setSelected] = useState<TextLine | null>(null);
  /** Whether a search is under way while earlier results stay on screen. */
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    setSearching(true);
    // Typing waits a little before searching.
    const timer = window.setTimeout(() => {
      gameText(root, filter).then(
        (result) => {
          if (!current) return;
          setLoaded({ state: 'ready', result });
          setSearching(false);
        },
        (error: unknown) => {
          if (!current) return;
          setLoaded({ state: 'failed', error: String(error) });
          setSearching(false);
        },
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
      void stop.then((unlisten) => unlisten());
    };
  }, [root, filter]);

  if (loaded.state === 'loading') {
    return (
      <LoadingPanel
        icon={Languages}
        title="Reading the game text"
        note="The first time reads every text table of data.rpf (about half a minute); then it is cached."
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

  const { result } = loaded;
  const query = filter.trim();
  return (
    <div className="flex min-w-0 flex-1">
      <main aria-label="Game text" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="font-title text-foreground">Text</span>
          <span className="font-mono tabular-nums">
            {query
              ? `${result.total.toLocaleString('en-US')} of ${result.searched.toLocaleString('en-US')} strings`
              : `${result.searched.toLocaleString('en-US')} English strings`}
            {result.total > result.lines.length && ` · first ${result.lines.length} shown`}
          </span>
          {searching && <span>Searching…</span>}
        </div>
        <div
          tabIndex={0}
          aria-label="Strings"
          onKeyDown={listKeys(result.lines, (line) => line.label + line.text, selected, setSelected, setSelected)}
          className="flex-1 overflow-auto outline-none"
        >
          {!query && (
            <p className="px-3 py-6 text-center text-muted-foreground">
              Type in the filter box to search the game&apos;s text: subtitles, item names, UI, messages. A label hash
              (8 hex digits) finds its string.
            </p>
          )}
          {query && result.lines.length === 0 && (
            <p className="px-3 py-6 text-center text-muted-foreground">No string matches.</p>
          )}
          {result.lines.map((line) => (
            <div
              key={line.label + line.text}
              role="row"
              data-row={line.label + line.text}
              onClick={() => setSelected(line)}
              className={`flex h-6 cursor-default items-center gap-3 px-3 ${
                selected?.label === line.label && selected.text === line.text
                  ? 'bg-primary/15 text-foreground'
                  : 'hover:bg-secondary'
              }`}
            >
              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{line.label}</span>
              <span className="truncate" title={line.text}>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      </main>
      {selected && (
        <PreviewPane title={selected.label} subtitle="String" onOpen={null}>
          <PreviewSection>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground select-text">{selected.text}</p>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(selected.text)}
              className="mt-2 inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-foreground hover:bg-muted"
            >
              <Copy className="size-3.5" />
              Copy
            </button>
          </PreviewSection>
          <PreviewSection>
            <Properties
              rows={[
                ['Label hash', selected.label],
                ['Table', selected.table],
              ]}
            />
            {selected.raw !== selected.text && (
              <p className="mt-2 font-mono text-xs break-all text-muted-foreground select-text">{selected.raw}</p>
            )}
          </PreviewSection>
        </PreviewPane>
      )}
    </div>
  );
}
