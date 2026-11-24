// Monaco, bundled locally (no CDN) and loaded on first use: import this module with `import()`.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};

// The tokens of src/styles.css: night greys, sunset accents, lagoon for values.
const ink = { 950: '#0e0b15', 900: '#15111f', 800: '#211b30', 700: '#2f2744', 400: '#9b92b0', 200: '#e4def0' };
const accent = { flamingo: '#ff4f9a', sunset: '#ff8a4c', gold: '#ffc35c', lagoon: '#2fd5c8' };
const bare = (color: string) => color.slice(1);

monaco.editor.defineTheme('openvi', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: bare(ink[200]) },
    { token: 'comment', foreground: bare(ink[400]), fontStyle: 'italic' },
    { token: 'delimiter', foreground: bare(ink[400]) },
    { token: 'tag', foreground: bare(accent.flamingo) },
    { token: 'metatag', foreground: bare(accent.sunset) },
    { token: 'attribute.name', foreground: bare(accent.gold) },
    { token: 'attribute.value', foreground: bare(accent.lagoon) },
    { token: 'string', foreground: bare(accent.lagoon) },
    { token: 'string.key.json', foreground: bare(accent.flamingo) },
    { token: 'string.value.json', foreground: bare(accent.lagoon) },
    { token: 'number', foreground: bare(accent.gold) },
    { token: 'keyword', foreground: bare(accent.sunset) },
  ],
  colors: {
    'editor.background': ink[950],
    'editor.foreground': ink[200],
    'editor.lineHighlightBackground': ink[900],
    'editor.selectionBackground': `${accent.flamingo}40`,
    'editor.inactiveSelectionBackground': `${accent.flamingo}26`,
    'editor.findMatchBackground': `${accent.sunset}66`,
    'editor.findMatchHighlightBackground': `${accent.gold}33`,
    'editorLineNumber.foreground': ink[700],
    'editorLineNumber.activeForeground': ink[400],
    'editorIndentGuide.background1': ink[800],
    'editorIndentGuide.activeBackground1': ink[700],
    'editorWidget.background': ink[900],
    'editorWidget.border': ink[800],
    'input.background': ink[950],
    'input.border': ink[800],
    focusBorder: `${accent.flamingo}99`,
    'scrollbarSlider.background': `${ink[700]}99`,
    'scrollbarSlider.hoverBackground': ink[700],
    'minimap.background': ink[950],
  },
});

export { monaco };
