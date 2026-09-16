import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';
import { clientBuildIdentity, refreshClientBuild } from './build/client-version.js';
import { artPreviewPlugin } from './vite/art-preview.js';
import { devCheckout } from './vite/dev-checkout.js';
import { serveContent } from './vite/serve-content.js';

const here = dirname(fileURLToPath(import.meta.url));
// The pipeline's output tree lives at the repo root (gitignored), outside the app's Vite root.
const contentRoot = resolve(here, '../..', process.env.ON_CONTENT_DIR ?? 'content');

export default defineConfig(async ({ command }) => ({
  root: here,
  resolve: { conditions: [...(command === 'serve' ? ['source'] : []), ...defaultClientConditions] },
  define: { __CLIENT_BUILD__: JSON.stringify(clientBuildIdentity(resolve(here, '../..'))) },
  plugins: [
    devCheckout(resolve(here, '../..'), contentRoot),
    serveContent(contentRoot),
    refreshClientBuild(resolve(here, '../..')),
    ...(command === 'serve' && process.env.ART_CANDIDATE
      ? [await artPreviewPlugin(resolve(here, '../..'), process.env.ART_CANDIDATE)]
      : []),
  ],
  server: { open: false },
  // `manifest` feeds scripts/bundle-report.mjs, which prints what each URL mode costs after the build.
  build: { target: 'es2022', outDir: 'dist', manifest: true },
}));
