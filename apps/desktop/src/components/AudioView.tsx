import { Download, Music, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  type AudioBank,
  type AudioStream,
  audioBanks,
  audioStreams,
  audioUrl,
  formatSeconds,
  saveAudio,
} from '../lib/audio';
import { type CatalogProgress, onCatalogProgress } from '../lib/catalog';
import { formatSize } from '../lib/format';
import { LoadingPanel } from './LoadingPanel';

type Loaded<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; error: string };

/** Most banks listed at once: the filter box narrows the rest. */
const SHOWN = 500;

/** The sound banks of audio.rpf, the streams of the one picked, and the stream picked played. */
export function AudioView({ root, filter }: { root: string; filter: string }) {
  const [banks, setBanks] = useState<Loaded<AudioBank[]>>({ state: 'loading' });
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  const [bank, setBank] = useState<AudioBank | null>(null);
  const [streams, setStreams] = useState<Loaded<AudioStream[]>>({ state: 'idle' });
  const [stream, setStream] = useState<AudioStream | null>(null);
  const [sound, setSound] = useState<Loaded<string>>({ state: 'idle' });
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const stop = onCatalogProgress((step) => current && setProgress(step));
    audioBanks(root).then(
      (value) => current && setBanks({ state: 'ready', value }),
      (error: unknown) => current && setBanks({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [root]);

  useEffect(() => {
    if (!bank) return;
    let current = true;
    setStreams({ state: 'loading' });
    setStream(null);
    audioStreams(root, bank.id).then(
      (value) => current && setStreams({ state: 'ready', value }),
      (error: unknown) => current && setStreams({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [root, bank]);

  useEffect(() => {
    if (!bank || !stream) return;
    let current = true;
    let url: string | null = null;
    setSound({ state: 'loading' });
    setSaved(null);
    audioUrl(root, bank.id, stream).then(
      (value) => {
        url = value;
        if (current) setSound({ state: 'ready', value });
        else URL.revokeObjectURL(value);
      },
      (error: unknown) => current && setSound({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [root, bank, stream]);

  const matching = useMemo(() => {
    if (banks.state !== 'ready') return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return banks.value;
    return banks.value.filter(
      (item) => item.id.includes(needle) || (item.name?.toLowerCase().includes(needle) ?? false),
    );
  }, [banks, filter]);

  if (banks.state === 'loading' || banks.state === 'idle') {
    return (
      <LoadingPanel
        icon={Music}
        title="Finding the sound banks"
        note="The first time scans audio.rpf for its banks (a few minutes); then it is cached."
        step={progress}
      />
    );
  }
  if (banks.state === 'failed') {
    return (
      <p className="grid min-w-0 flex-1 place-items-center px-10 text-center text-xs text-destructive">{banks.error}</p>
    );
  }

  const streamList = streams.state === 'ready' ? streams.value : [];
  return (
    <div className="flex min-w-0 flex-1 text-xs">
      <aside aria-label="Sound banks" className="flex w-80 shrink-0 flex-col border-r border-border bg-card">
        <header className="border-b border-border px-3 py-2 text-muted-foreground">
          <span className="font-title text-foreground">Banks</span>{' '}
          {matching.length === banks.value.length
            ? banks.value.length.toLocaleString('en-US')
            : `${matching.length.toLocaleString('en-US')} of ${banks.value.length.toLocaleString('en-US')}`}
          {matching.length > SHOWN && ` · first ${SHOWN} shown`}
        </header>
        <div className="flex-1 overflow-auto">
          {matching.slice(0, SHOWN).map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.name ?? item.id}
              onClick={() => setBank(item)}
              className={`flex h-6 w-full items-center gap-2 px-3 text-left ${
                bank?.id === item.id ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
            >
              <span className="truncate font-mono">{item.name ?? item.id}</span>
              <span className="ml-auto shrink-0 font-mono text-muted-foreground tabular-nums">
                {item.streams} · {formatSeconds(item.seconds)}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <main aria-label="Streams" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-muted-foreground">
          <span className="truncate font-title text-foreground">
            {bank ? (bank.name ?? `Bank ${bank.id}`) : 'Streams'}
          </span>
          {bank && (
            <span className="font-mono tabular-nums">
              {bank.streams} streams · {formatSeconds(bank.seconds)} · {formatSize(bank.size)}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {!bank && <p className="px-3 py-6 text-center text-muted-foreground">Pick a bank.</p>}
          {streams.state === 'loading' && <p className="px-3 py-2 text-muted-foreground">Reading…</p>}
          {streams.state === 'failed' && <p className="px-3 py-2 text-destructive">{streams.error}</p>}
          {streamList.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!item.playable}
              onClick={() => setStream(item)}
              title={item.playable ? 'Play' : `${item.layout} streams cannot be played`}
              className={`flex h-6 w-full items-center gap-2 px-3 text-left disabled:opacity-40 ${
                stream?.id === item.id ? 'bg-primary/15 text-foreground' : 'hover:bg-secondary'
              }`}
            >
              <Play className="size-3 shrink-0 text-primary" />
              <span className="truncate font-mono">{item.name ?? item.id}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {item.layout === 'music' ? `music, ${item.channels} stems` : `${item.channels} ch`}
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-muted-foreground tabular-nums">
                {formatSeconds(item.seconds)}
              </span>
            </button>
          ))}
        </div>
        {stream && bank && (
          <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-3 py-2">
            <span className="w-48 shrink-0 truncate font-mono text-foreground" title={stream.name ?? stream.id}>
              {stream.name ?? stream.id}
            </span>
            {sound.state === 'loading' && <span className="flex-1 text-muted-foreground">Reading the stream…</span>}
            {sound.state === 'failed' && <span className="flex-1 truncate text-destructive">{sound.error}</span>}
            {sound.state === 'ready' && (
              // oxlint-disable-next-line jsx-a11y/media-has-caption -- game sounds carry no caption track
              <audio key={sound.value} src={sound.value} controls autoPlay className="h-8 min-w-0 flex-1" />
            )}
            {stream.layout === 'music' && <span className="text-muted-foreground">first stem</span>}
            <button
              type="button"
              onClick={() =>
                saveAudio(root, bank.id, stream).then(
                  (dest) => dest && setSaved(`Saved to ${dest}`),
                  (error: unknown) => setSaved(String(error)),
                )
              }
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-muted"
            >
              <Download className="size-3.5" />
              Save
            </button>
            {saved && (
              <span className="max-w-64 truncate text-muted-foreground" title={saved}>
                {saved}
              </span>
            )}
          </footer>
        )}
      </main>
    </div>
  );
}
