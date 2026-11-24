import type * as Monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

type MonacoApi = typeof Monaco;

/** A read-only Monaco editor: highlighting, line numbers, folding, minimap, Ctrl+F. */
export function CodeView({ value, language, wrap }: { value: string; language: string; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const api = useRef<MonacoApi | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    void import('../lib/monaco').then(({ monaco }) => {
      if (disposed || !host.current) return;
      api.current = monaco;
      editor.current = monaco.editor.create(host.current, {
        model: null,
        theme: 'openvi',
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', monospace",
        fontSize: 12,
        lineHeight: 18,
        minimap: { enabled: true, renderCharacters: false },
        scrollBeyondLastLine: false,
        stickyScroll: { enabled: true },
        folding: true,
        renderLineHighlight: 'line',
        padding: { top: 8 },
      });
      setReady(true);
    });
    return () => {
      disposed = true;
      editor.current?.getModel()?.dispose();
      editor.current?.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    const monaco = api.current;
    if (!ready || !instance || !monaco) return;
    const previous = instance.getModel();
    instance.setModel(monaco.editor.createModel(value, language));
    previous?.dispose();
    instance.setScrollTop(0);
  }, [ready, value, language]);

  useEffect(() => {
    editor.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
  }, [ready, wrap]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={host} className="absolute inset-0" />
      {!ready && <p className="absolute inset-0 grid place-items-center text-xs text-ink-400">Loading editor…</p>}
    </div>
  );
}
