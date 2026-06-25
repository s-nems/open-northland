import { createReadStream, existsSync } from 'node:fs';
import { dirname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig } from 'vite';

// Browser-first app shell. `npm run dev` serves this with HMR; cross-platform by construction.
// Desktop (Mac/Win/Linux) packaging via Tauri comes later (Phase 5).

const here = dirname(fileURLToPath(import.meta.url));
// The decoded `content/maps/<id>.json` grids live at the repo root (gitignored; generated from an
// owned game copy). They sit OUTSIDE the app's vite root, so a dev-server middleware bridges them in
// at `/maps/<id>.json` for the browser `loadTerrainMap` fetch. Path traversal is rejected (the
// resolved file must stay under `content/maps`), so `?map=` can only reach a real map grid, never an
// arbitrary file. Both `npm run dev` and the shot harness boot this same root, so both can `?map=`.
const mapsRoot = resolve(here, '../../content/maps');

function serveContentMaps(): Plugin {
  return {
    name: 'vinland-serve-content-maps',
    configureServer(server) {
      server.middlewares.use('/maps', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        const file = normalize(resolve(mapsRoot, rel));
        if (!file.startsWith(mapsRoot + sep) || !file.endsWith('.json') || !existsSync(file)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveContentMaps()],
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist' },
});
