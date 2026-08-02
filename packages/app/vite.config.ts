import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isContentRoute, resolveContentRequest } from '@open-northland/content-resolver';
import { defineConfig, type Plugin } from 'vite';

// Browser-first app shell. `npm run dev` serves this with HMR; the desktop shell (packages/desktop)
// wraps the same build and serves the same routes over its app:// protocol.
// Vite resolves every `@open-northland/*` import to that package's `dist/` (gitignored), so `dev` and
// `shot` run `tsc --build` first: without it the server silently serves a stale sim/render/data
// surface and the app crashes on a member the current source has but the last build did not.

const here = dirname(fileURLToPath(import.meta.url));
// The decoded `content/` tree lives at the repo root (gitignored; generated from an owned game copy),
// OUTSIDE the app's vite root. The shared route table (`@open-northland/content-resolver`) bridges it in
// - `/maps`, `/bobs`, `/textures`, `/sounds`, `/ir.json`, `/gui`, `/gui-bitmaps`, `/goods`, plus the
// computed `/maps-index` + `/bobs-index` menu/gallery payloads - with path traversal rejected and only
// per-route extensions served. An in-namespace miss is answered 404 HERE: Vite's SPA fallback would
// otherwise serve `index.html` as HTTP 200 `text/html` and the loaders' `!res.ok` absence checks would
// mis-read a missing `content/` as bytes. Off-namespace paths fall through to Vite as before.
const contentRoot = resolve(here, '../../content');

function serveContent(): Plugin {
  return {
    name: 'opennorthland-serve-content',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        const hit = resolveContentRequest(pathname, contentRoot);
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
          res.end(JSON.stringify(hit.body()));
          return;
        }
        res.setHeader('Content-Type', hit.contentType);
        createReadStream(hit.path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveContent()],
  server: { port: 5173, open: false },
  // Pixi + the app ship as one ~810 kB main chunk (≈248 kB gzip). That is expected for a Pixi game
  // loaded once, so lift Vite's 500 kB chunk-size warning to 1 MB instead of splitting the renderer out.
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 1024 },
});
