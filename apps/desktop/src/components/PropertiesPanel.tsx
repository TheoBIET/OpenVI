import { useEffect, useState } from 'react';

import { formatOffset, formatSize } from '../lib/format';
import type { Entry } from '../lib/fs';
import { archiveOf } from '../lib/index';
import { type ResourceDetails, resourceInfo, texturePreview } from '../lib/resource';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: string };

/** Details of the selected resource, with a preview of the textures it holds. */
export function PropertiesPanel({ root, entry }: { root: string; entry: Entry }) {
  const [details, setDetails] = useState<Loaded<ResourceDetails>>({ state: 'loading' });
  const [texture, setTexture] = useState(0);
  const [preview, setPreview] = useState<Loaded<string>>({ state: 'loading' });

  useEffect(() => {
    let current = true;
    setDetails({ state: 'loading' });
    setTexture(0);
    // Loading inflates the whole resource (models run to tens of MB): wait until the selection settles, so
    // walking the list with the arrow keys does not load every row on the way.
    const timer = setTimeout(() => {
      resourceInfo(root, entry.path).then(
        (value) => current && setDetails({ state: 'ready', value }),
        (error: unknown) => current && setDetails({ state: 'failed', error: String(error) }),
      );
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [root, entry.path]);

  const textures = details.state === 'ready' ? details.value.textures : [];
  const hasTextures = textures.length > 0;

  useEffect(() => {
    if (!hasTextures) return;
    let current = true;
    let url: string | null = null;
    setPreview({ state: 'loading' });
    texturePreview(root, entry.path, texture).then(
      (value) => {
        url = value;
        if (current) setPreview({ state: 'ready', value });
        else URL.revokeObjectURL(value);
      },
      (error: unknown) => current && setPreview({ state: 'failed', error: String(error) }),
    );
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [root, entry.path, texture, hasTextures]);

  const shown = textures[texture];
  const archive = entry.location ?? archiveOf(entry.path).split(/[\\/]/).at(-1);

  return (
    <aside
      aria-label="Properties"
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-ink-800 bg-ink-900"
    >
      <header className="border-b border-ink-800 px-3 py-2">
        <h2 className="truncate font-medium text-white" title={entry.name}>
          {entry.name}
        </h2>
        <p className="text-xs text-ink-400">{entry.typeName}</p>
      </header>
      <div className="flex-1 overflow-auto">
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <Property label="Archive" value={archive} />
          <Property label="Offset" value={entry.offset === undefined ? '' : formatOffset(entry.offset)} mono />
          <Property label="Size" value={formatSize(entry.size)} mono />
          {details.state === 'ready' && (
            <>
              <Property label="Compressed" value={formatSize(details.value.compressedSize)} mono />
              <Property label="Streams" value={String(details.value.streams)} mono />
              <Property label="Sub type" value={details.value.subType || '–'} mono />
              <Property label="Tag" value={details.value.resourceType ?? '–'} mono />
            </>
          )}
        </dl>
        {details.state === 'failed' && <p className="px-3 py-2 text-xs text-flamingo">{details.error}</p>}
        {hasTextures && (
          <section aria-label="Textures" className="border-t border-ink-800 px-3 py-2">
            <h3 className="mb-2 text-xs font-medium text-flamingo">
              Textures <span className="text-ink-400">({textures.length})</span>
            </h3>
            <div className="checkerboard grid aspect-square place-items-center overflow-hidden rounded border border-ink-800">
              {preview.state === 'ready' && (
                <img src={preview.value} alt={shown?.name ?? ''} className="max-h-full max-w-full object-contain" />
              )}
              {preview.state === 'loading' && <span className="text-xs text-ink-400">Decoding…</span>}
              {preview.state === 'failed' && (
                <span className="px-3 text-center text-xs text-flamingo">{preview.error}</span>
              )}
            </div>
            {shown && (
              <p className="mt-1 truncate font-mono text-[11px] text-ink-400">
                {shown.width}×{shown.height} · {shown.format} · {shown.mips} mip{shown.mips === 1 ? '' : 's'}
              </p>
            )}
            <ul className="mt-2">
              {textures.map((item) => (
                <li key={item.index}>
                  <button
                    type="button"
                    onClick={() => setTexture(item.index)}
                    className={`flex h-6 w-full items-center gap-2 rounded px-1.5 text-left text-xs ${
                      item.index === texture ? 'bg-flamingo/15 text-white' : 'text-ink-200 hover:bg-ink-800'
                    }`}
                  >
                    <span className="truncate">{item.name || `texture ${item.index}`}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-400">
                      {item.width}×{item.height}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

function Property({ label, value, mono = false }: { label: string; value: string | undefined; mono?: boolean }) {
  return (
    <>
      <dt className="text-ink-400">{label}</dt>
      <dd className={`truncate text-ink-200 ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </>
  );
}
