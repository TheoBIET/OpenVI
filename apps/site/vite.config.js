import { cpSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const icons = new URL('./node_modules/lucide-static/icons/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** GitHub's mark (Lucide has no brand icons). */
const GITHUB =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

/** Inlines `<i data-icon="name" class="…"></i>` as the Lucide SVG at build time, and the version as `%VERSION%`. */
function inlineIcons() {
  return {
    name: 'openvi-inline-icons',
    transformIndexHtml(html) {
      return html
        .replaceAll('%VERSION%', version)
        .replace(/<i data-icon="([a-z0-9-]+)" class="([^"]*)"><\/i>/g, (_, name, classes) => {
          const svg = name === 'github' ? GITHUB : readFileSync(new URL(`${name}.svg`, icons), 'utf8');
          return svg
            .replace(/<!--.*?-->\s*/s, '')
            .replace(/\s*class="[^"]*"/, '')
            .replace('<svg', `<svg class="${classes}" aria-hidden="true"`)
            .replace(/\s+/g, ' ')
            .replace('> <', '><');
        });
    },
  };
}

/** The screenshots and clips of `docs/media` (the README's), served at `media/` and copied into the build. */
const media = fileURLToPath(new URL('../../docs/media', import.meta.url));
function docsMedia() {
  return {
    name: 'openvi-docs-media',
    configureServer(server) {
      server.middlewares.use('/OpenVI/media', (request, response, next) => {
        const file = `${media}${decodeURIComponent((request.url ?? '').split('?')[0] ?? '')}`;
        if (!existsSync(file)) return next();
        response.end(readFileSync(file));
      });
    },
    writeBundle(options) {
      if (existsSync(media)) cpSync(media, `${options.dir}/media`, { recursive: true });
    },
  };
}

export default defineConfig({
  base: '/OpenVI/',
  plugins: [tailwindcss(), inlineIcons(), docsMedia()],
});
