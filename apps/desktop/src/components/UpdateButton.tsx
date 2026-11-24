import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type State =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'latest' }
  | { state: 'available'; update: Update }
  | { state: 'installing'; update: Update; done: number; total: number | null }
  | { state: 'failed'; error: string };

/** Checked on start (a few seconds in) and then every six hours. */
const FIRST_CHECK = 5_000;
const EVERY = 6 * 60 * 60 * 1000;

const version = import.meta.env.VITE_APP_VERSION;

/**
 * The version in the status bar, and the app's updates: a newer release on GitHub shows as an "Update" button that
 * downloads it, checks its signature, installs it and restarts. Clicking the version checks at once. Development
 * builds (`pnpm dev`) never check.
 */
export function UpdateButton() {
  const [status, setStatus] = useState<State>({ state: 'idle' });
  const busy = useRef(false);

  async function lookForUpdate(quiet: boolean) {
    if (busy.current) return;
    busy.current = true;
    if (!quiet) setStatus({ state: 'checking' });
    try {
      const update = await check();
      setStatus(update ? { state: 'available', update } : { state: quiet ? 'idle' : 'latest' });
    } catch (error) {
      // Offline or no release yet: say so only when asked.
      setStatus(quiet ? { state: 'idle' } : { state: 'failed', error: String(error) });
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const first = window.setTimeout(() => void lookForUpdate(true), FIRST_CHECK);
    const every = window.setInterval(() => void lookForUpdate(true), EVERY);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  async function install(update: Update) {
    let done = 0;
    let total: number | null = null;
    setStatus({ state: 'installing', update, done, total });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? null;
        if (event.event === 'Progress') done += event.data.chunkLength;
        setStatus({ state: 'installing', update, done, total });
      });
      await relaunch();
    } catch (error) {
      setStatus({ state: 'failed', error: String(error) });
    }
  }

  if (status.state === 'available') {
    const notes = status.update.body?.trim();
    return (
      <button
        type="button"
        onClick={() => void install(status.update)}
        title={`Install OpenVI ${status.update.version} and restart${notes ? `\n\n${notes}` : ''}`}
        className="flex h-4.5 items-center gap-1 rounded-sm bg-accent-gradient px-1.5 font-semibold text-on-accent"
      >
        <Download className="size-3" />
        Update to {status.update.version}
      </button>
    );
  }
  if (status.state === 'installing') {
    const percent = status.total ? ` ${Math.min(100, Math.round((status.done / status.total) * 100))}%` : '';
    return (
      <span className="flex items-center gap-1 font-mono text-foreground">
        <RefreshCw className="size-3 animate-spin" />
        Updating to {status.update.version}
        {percent}
      </span>
    );
  }

  let label = `OpenVI ${version}`;
  let title = 'Check for updates';
  if (status.state === 'checking') label = `OpenVI ${version} · checking…`;
  if (status.state === 'latest') label = `OpenVI ${version} · up to date`;
  if (status.state === 'failed') {
    label = `OpenVI ${version} · update check failed`;
    title = status.error;
  }
  return (
    <button
      type="button"
      onClick={() => void lookForUpdate(false)}
      disabled={import.meta.env.DEV}
      title={import.meta.env.DEV ? 'Development build: no updates' : title}
      className={`font-mono hover:text-foreground disabled:hover:text-muted-foreground ${
        status.state === 'failed' ? 'text-warning' : ''
      }`}
    >
      {label}
    </button>
  );
}
