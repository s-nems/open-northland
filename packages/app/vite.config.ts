import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveContentRequest } from '@open-northland/content-routes';
import { defineConfig, type Plugin } from 'vite';

// Browser-first app shell. `npm run dev` serves this with HMR; the desktop shell (packages/desktop)
// wraps the same build and serves the same routes over its app:// protocol.

const here = dirname(fileURLToPath(import.meta.url));
// The decoded `content/` tree lives at the repo root (gitignored; generated from an owned game copy),
// OUTSIDE the app's vite root. The shared route table (`@open-northland/content-routes`) bridges it in
// — `/maps`, `/bobs`, `/textures`, `/sounds`, `/ir.json`, `/gui`, `/gui-bitmaps`, `/goods`, plus the
// computed `/maps-index` + `/bobs-index` menu/gallery payloads — with path traversal rejected and only
// per-route extensions served. Anything unmatched or absent falls through to Vite's 404, so a checkout
// without `content/` still boots (the menu shows a "run the pipeline" hint instead of map cards).
const contentRoot = resolve(here, '../../content');

function serveContent(): Plugin {
  return {
    name: 'opennorthland-serve-content',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        const hit = resolveContentRequest(pathname, contentRoot);
        if (hit === undefined) {
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
