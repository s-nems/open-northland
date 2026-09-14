import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isContentRoute, resolveContentRequest } from '@open-northland/content-resolver';
import { nodeVfs } from '@open-northland/vfs/node';
import { defineConfig, type Plugin } from 'vite';
import { clientBuildIdentity } from './build/client-version.js';
import { artPreviewPlugin } from './vite/art-preview.js';

// Browser-first app shell. `npm run dev` serves this with HMR; the desktop shell (packages/desktop)
// wraps the same build and serves the same routes over its app:// protocol.
// Vite resolves every `@open-northland/*` import to that package's `dist/` (gitignored), so `dev` and
// `shot` run `tsc --build` first: without it the server silently serves a stale sim/render/data
// surface and the app crashes on a member the current source has but the last build did not.

const here = dirname(fileURLToPath(import.meta.url));
// The decoded `content/` tree lives at the repo root (gitignored; generated from the CulturesNation mod),
// OUTSIDE the app's vite root. The shared route table (`@open-northland/content-resolver`) bridges it in
// - `/maps`, `/bobs`, `/textures`, `/sounds`, `/ir.json`, `/gui`, `/gui-bitmaps`, `/goods`,
// `/backdrops`, plus the computed index payloads - with path traversal rejected and only
// per-route extensions served. An in-namespace miss is answered 404 HERE: Vite's SPA fallback would
// otherwise serve `index.html` as HTTP 200 `text/html` and the loaders' `!res.ok` absence checks would
// mis-read a missing `content/` as bytes. Off-namespace paths fall through to Vite as before.
const contentRoot = resolve(here, '../..', process.env.ON_CONTENT_DIR ?? 'content');
const configuredBasePath = process.env.OPEN_NORTHLAND_BASE_PATH ?? '/';
const basePath =
  configuredBasePath === '/' ? '/' : `/${configuredBasePath.split('/').filter(Boolean).join('/')}/`;

function serveContent(): Plugin {
  const fs = nodeVfs();
  return {
    name: 'opennorthland-serve-content',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPathname = (req.url ?? '').split('?')[0] ?? '';
        const pathname =
          basePath === '/'
            ? requestPathname
            : requestPathname.startsWith(basePath)
              ? `/${requestPathname.slice(basePath.length)}`
              : requestPathname;
        void (async () => {
          const hit = await resolveContentRequest(fs, pathname, contentRoot);
          if (hit === undefined) {
            if (isContentRoute(pathname)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            next();
            return;
          }
          if (hit.kind === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(await hit.body()));
            return;
          }
          res.setHeader('Content-Type', hit.contentType);
          createReadStream(hit.path).pipe(res);
        })().catch(next);
      });
    },
  };
}

export default defineConfig(async ({ command }) => ({
  define: { __CLIENT_BUILD__: JSON.stringify(clientBuildIdentity(resolve(here, '../..'))) },
  base: basePath,
  plugins: [
    serveContent(),
    ...(command === 'serve' && process.env.ART_CANDIDATE
      ? [await artPreviewPlugin(resolve(here, '../..'), process.env.ART_CANDIDATE)]
      : []),
  ],
  server: { port: 5173, open: false },
  // `manifest` feeds scripts/bundle-report.mjs, which prints what each URL mode costs after the build.
  build: { target: 'es2022', outDir: 'dist', manifest: true },
}));
