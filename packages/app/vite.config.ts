import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { clientBuildIdentity } from './build/client-version.js';
import { artPreviewPlugin } from './vite/art-preview.js';
import { serveContent } from './vite/serve-content.js';

// Browser-first app shell. `npm run dev` serves this with HMR; the desktop shell (packages/desktop)
// serves the same build and the same content tree over its app:// protocol.
// Vite resolves every `@open-northland/*` import to that package's `dist/` (gitignored), so `dev` and
// `shot` run `tsc --build` first: without it the server silently serves a stale sim/render/data
// surface and the app crashes on a member the current source has but the last build did not.

const here = dirname(fileURLToPath(import.meta.url));
// The pipeline's output tree lives at the repo root (gitignored), outside the app's Vite root.
const contentRoot = resolve(here, '../..', process.env.ON_CONTENT_DIR ?? 'content');

export default defineConfig(async ({ command }) => ({
  define: { __CLIENT_BUILD__: JSON.stringify(clientBuildIdentity(resolve(here, '../..'))) },
  plugins: [
    serveContent(contentRoot),
    ...(command === 'serve' && process.env.ART_CANDIDATE
      ? [await artPreviewPlugin(resolve(here, '../..'), process.env.ART_CANDIDATE)]
      : []),
  ],
  server: { port: 5173, open: false },
  // `manifest` feeds scripts/bundle-report.mjs, which prints what each URL mode costs after the build.
  build: { target: 'es2022', outDir: 'dist', manifest: true },
}));
