// Monaco, bundled locally (no CDN) and loaded on first use: import this module with `import()`.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};

// The tokens of src/styles.css: neutral surfaces, the magenta → violet → cyan accent.
const surface = {
  background: '#121212',
  card: '#171717',
  secondary: '#1e1e1e',
  muted: '#252525',
  border: '#2d2d2d',
  input: '#383838',
  mutedForeground: '#9c9c9c',
  foreground: '#f0f0f0',
};
const accent = { from: '#ff4fa3', mid: '#a855f7', to: '#38d6ff', warning: '#e2ad4b' };
const bare = (color: string) => color.slice(1);

monaco.editor.defineTheme('openvi', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: bare(surface.foreground) },
    { token: 'comment', foreground: bare(surface.mutedForeground), fontStyle: 'italic' },
    { token: 'delimiter', foreground: bare(surface.mutedForeground) },
    { token: 'tag', foreground: bare(accent.from) },
    { token: 'metatag', foreground: bare(accent.mid) },
    { token: 'attribute.name', foreground: bare(accent.mid) },
    { token: 'attribute.value', foreground: bare(accent.to) },
    { token: 'string', foreground: bare(accent.to) },
    { token: 'string.key.json', foreground: bare(accent.from) },
    { token: 'string.value.json', foreground: bare(accent.to) },
    { token: 'number', foreground: bare(accent.warning) },
    { token: 'keyword', foreground: bare(accent.mid) },
  ],
  colors: {
    'editor.background': surface.background,
    'editor.foreground': surface.foreground,
    'editor.lineHighlightBackground': surface.card,
    // Selected text: the first accent colour at 45 %, as everywhere in the app.
    'editor.selectionBackground': `${accent.from}73`,
    'editor.inactiveSelectionBackground': `${accent.from}33`,
    'editor.findMatchBackground': `${accent.mid}80`,
    'editor.findMatchHighlightBackground': `${accent.to}33`,
    'editorLineNumber.foreground': surface.input,
    'editorLineNumber.activeForeground': surface.mutedForeground,
    'editorIndentGuide.background1': surface.muted,
    'editorIndentGuide.activeBackground1': surface.input,
    'editorWidget.background': surface.secondary,
    'editorWidget.border': surface.border,
    'input.background': surface.background,
    'input.border': surface.border,
    focusBorder: accent.from,
    'scrollbarSlider.background': `${surface.muted}cc`,
    'scrollbarSlider.hoverBackground': surface.input,
    'minimap.background': surface.background,
  },
});

export { monaco };
