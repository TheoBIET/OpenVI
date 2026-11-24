import { useEffect, useState } from 'react';

import { fileImage, filePreview, resourceImage } from '../lib/document';
import { saveResource, saveTexture } from '../lib/export';
import { formatOffset, formatSize, typeLabel } from '../lib/format';
import type { Entry } from '../lib/fs';
import { archiveOf } from '../lib/index';
import { modelPreview } from '../lib/model';
import { resourceInfo, textPreview, texturePreview } from '../lib/resource';
import { isViewable, MODEL_TYPES, TEXT_TYPES } from './DocumentView';
import {
  ModelPreview,
  PanelButton,
  PENDING,
  PreviewPane,
  PreviewSection,
  Properties,
  TextSnippet,
  TextSnippetSkeleton,
  useSettled,
} from './preview';
import { Skeleton } from './skeleton';

/** Revokes an object URL once it is replaced or the pane goes. */
function useObjectUrl(url: string | null) {
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );
}

/**
 * The preview of the selected entry: a folder or an archive (what it holds), a loose file (text or image), a resource
 * (its details, textures, text, image or 3D model). `onOpen` opens it on its own, like a double-click.
 */
export function PropertiesPanel({
  root,
  entry,
  onOpen,
}: {
  root: string;
  entry: Entry;
  onOpen: (entry: Entry) => void;
}) {
  const open = entry.kind === 'folder' || entry.kind === 'archive' || isViewable(entry) ? () => onOpen(entry) : null;
  return (
    <PreviewPane title={entry.name} subtitle={typeLabel(entry)} onOpen={open}>
      {entry.kind === 'folder' && (
        <PreviewSection>
          <Properties rows={[['Items', entry.items ?? '?']]} />
        </PreviewSection>
      )}
      {entry.kind === 'archive' && (
        <PreviewSection>
          <Properties rows={[['Size', formatSize(entry.size), true]]} />
          <p className="mt-2 text-muted-foreground">Open it to list its resources; the first opening scans it.</p>
        </PreviewSection>
      )}
      {entry.kind === 'file' && <FilePreview root={root} entry={entry} />}
      {entry.kind === 'resource' && <ResourcePreview root={root} entry={entry} />}
    </PreviewPane>
  );
}

function FilePreview({ root, entry }: { root: string; entry: Entry }) {
  const preview = useSettled(entry.path, () => filePreview(root, entry.path), 150);
  const mime = preview.state === 'ready' && preview.value.kind === 'image' ? preview.value.mime : null;
  const image = useSettled(`${entry.path}:${mime ?? ''}`, mime ? () => fileImage(root, entry.path, mime) : null, 0);
  useObjectUrl(image.state === 'ready' ? image.value : null);

  return (
    <>
      <PreviewSection>
        <Properties rows={[['Size', formatSize(entry.size), true]]} />
      </PreviewSection>
      <PreviewSection>
        {(preview.state === 'loading' || preview.state === 'idle') && <TextSnippetSkeleton />}
        {preview.state === 'failed' && <p className="text-destructive">{preview.error}</p>}
        {mime && image.state !== 'ready' && image.state !== 'failed' && <Skeleton className="h-40 w-full" />}
        {preview.state === 'ready' && preview.value.kind === 'text' && <TextSnippet text={preview.value.text} />}
        {preview.state === 'ready' && preview.value.kind === 'binary' && (
          <p className="text-muted-foreground">Binary data: no preview.</p>
        )}
        {image.state === 'ready' && (
          <div className="checkerboard grid place-items-center overflow-hidden rounded-sm border border-border">
            <img src={image.value} alt={entry.name} className="max-h-80 max-w-full object-contain" />
          </div>
        )}
      </PreviewSection>
    </>
  );
}

function ResourcePreview({ root, entry }: { root: string; entry: Entry }) {
  const type = entry.typeName ?? '';
  // Loading inflates the whole resource (models run to tens of MB): useSettled waits for the selection to settle.
  const details = useSettled(entry.path, () => resourceInfo(root, entry.path), 150);
  const text = useSettled(entry.path, TEXT_TYPES.has(type) ? () => textPreview(root, entry.path) : null);
  const model = useSettled(entry.path, MODEL_TYPES.has(type) ? () => modelPreview(root, entry.path) : null, 400);
  const png = useSettled(entry.path, type === 'PNG Image' ? () => resourceImage(root, entry.path) : null);
  useObjectUrl(png.state === 'ready' ? png.value : null);

  const [texture, setTexture] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    setTexture(0);
    setSaved(null);
  }, [entry.path]);
  const textures = details.state === 'ready' ? details.value.textures : [];
  const shown = textures[texture];
  const thumb = useSettled(
    `${entry.path}:${shown?.index ?? -1}`,
    shown ? () => texturePreview(root, entry.path, shown.index) : null,
    0,
  );
  useObjectUrl(thumb.state === 'ready' ? thumb.value : null);

  function run(save: () => Promise<string | null>) {
    save().then(
      (dest) => dest && setSaved(`Saved to ${dest}`),
      (error: unknown) => setSaved(String(error)),
    );
  }

  const archive = entry.location ?? archiveOf(entry.path).split(/[\\/]/).at(-1);
  const info = details.state === 'ready' ? details.value : null;
  // Rows waiting for the details keep their place; a failure drops them.
  function later<T>(value: T): T | null | typeof PENDING {
    if (details.state === 'ready') return value;
    return details.state === 'failed' ? null : PENDING;
  }

  return (
    <>
      {MODEL_TYPES.has(type) && (
        <PreviewSection>
          <ModelPreview loaded={model} waiting="Exporting the model…" />
        </PreviewSection>
      )}
      {type === 'PNG Image' && (
        <PreviewSection>
          {png.state === 'ready' ? (
            <div className="checkerboard grid place-items-center overflow-hidden rounded-sm border border-border">
              <img src={png.value} alt={entry.name} className="max-h-80 max-w-full object-contain" />
            </div>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </PreviewSection>
      )}
      {TEXT_TYPES.has(type) && (
        <PreviewSection>
          {text.state === 'ready' && <TextSnippet text={text.value.text} />}
          {text.state === 'failed' && <p className="text-destructive">{text.error}</p>}
          {(text.state === 'loading' || text.state === 'idle') && <TextSnippetSkeleton />}
        </PreviewSection>
      )}
      <PreviewSection>
        <Properties
          rows={[
            ['Archive', archive],
            ['Offset', entry.offset === undefined ? null : formatOffset(entry.offset), true],
            ['Size', formatSize(entry.size), true],
            ['Compressed', later(info && formatSize(info.compressedSize)), true],
            ['Streams', later(info?.streams), true],
            ['Sub type', later(info?.subType), true],
            ['Tag', later(info?.resourceType), true],
          ]}
        />
        {details.state === 'failed' && <p className="mt-2 text-destructive">{details.error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <PanelButton
            label="Save raw…"
            onClick={() =>
              run(() => saveResource(root, entry.path, info ? `${entry.name}.${info.extension}` : entry.name))
            }
          />
          {shown && (
            <PanelButton
              label="Save PNG…"
              onClick={() => run(() => saveTexture(root, entry.path, shown.index, shown.name))}
            />
          )}
        </div>
        {saved && <p className="mt-2 break-all text-muted-foreground">{saved}</p>}
      </PreviewSection>
      {textures.length > 0 && (
        <PreviewSection title={`Textures (${textures.length})`}>
          <div className="checkerboard grid aspect-square place-items-center overflow-hidden rounded-sm border border-border">
            {thumb.state === 'ready' && (
              <img src={thumb.value} alt={shown?.name ?? ''} className="max-h-full max-w-full object-contain" />
            )}
            {thumb.state !== 'ready' && thumb.state !== 'failed' && <Skeleton className="h-full w-full rounded-none" />}
            {thumb.state === 'failed' && <span className="px-3 text-center text-destructive">{thumb.error}</span>}
          </div>
          {shown && (
            <p className="mt-1 truncate font-mono text-muted-foreground">
              {shown.width}×{shown.height} · {shown.format} · {shown.mips} mip{shown.mips === 1 ? '' : 's'}
            </p>
          )}
          <ul className="mt-2">
            {textures.map((item) => (
              <li key={item.index}>
                <button
                  type="button"
                  onClick={() => setTexture(item.index)}
                  className={`flex h-6 w-full items-center gap-2 rounded-sm px-1.5 text-left ${
                    item.index === texture ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <span className="truncate">{item.name || `texture ${item.index}`}</span>
                  <span className="ml-auto shrink-0 font-mono text-muted-foreground">
                    {item.width}×{item.height}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </PreviewSection>
      )}
    </>
  );
}
