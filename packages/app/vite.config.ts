import { createReadStream, existsSync, readdirSync } from 'node:fs';
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
// Decoded bob atlases (`<name>.png` + `<name>.atlas.json`) the `.bmd`→atlas pipeline emits. Like the
// maps, they are gitignored (decoded from an owned game copy) and sit outside the app's vite root, so a
// middleware bridges them in at `/bobs/<name>.*` for the `?atlas=real` fetch (see real-sprites.ts). Path
// traversal is rejected and only `.png` / `.atlas.json` are served, so `/bobs/` can only reach a decoded
// atlas, never an arbitrary file.
const bobsRoot = resolve(here, '../../content/Data/engine2d/bin/bobs');
// Decoded ground textures (`text_NNN.png`, 256×256 RGBA) the `.pcx`→PNG pipeline stage emits — the
// `?terrain` real-ground render samples them (see real-terrain.ts). Same stance as `/bobs`: gitignored,
// outside the vite root, bridged in at `/textures/<name>.png` with traversal rejected + `.png` only.
const texturesRoot = resolve(here, '../../content/Data/engine2d/bin/textures');
// The validated IR (`content/ir.json`) carries the approximated `terrainPatterns` typeId→ground table
// the `?terrain` binding reads; bridged in at `/ir.json` (the one file, not the tree).
const irFile = resolve(here, '../../content/ir.json');

// The MENU (entries/menu.ts) lists the decoded maps as clickable cards; it reads their stems from this
// route — the `.json` filenames under `content/maps` (minus the extension), sorted. Absent `content/`
// returns nothing (the middleware falls through to Vite's 404), so the menu shows a "run the pipeline"
// hint instead of map cards. Only names a directory listing, never file bytes — the `/maps` route above
// serves the grids themselves (with traversal rejected).
function serveMapsIndex(): Plugin {
  return {
    name: 'vinland-serve-maps-index',
    configureServer(server) {
      server.middlewares.use('/maps-index', (_req, res, next) => {
        if (!existsSync(mapsRoot)) {
          next();
          return;
        }
        const stems = readdirSync(mapsRoot)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -'.json'.length))
          .sort();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(stems));
      });
    },
  };
}

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

function serveContentBobs(): Plugin {
  return {
    name: 'vinland-serve-content-bobs',
    configureServer(server) {
      server.middlewares.use('/bobs', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        const file = normalize(resolve(bobsRoot, rel));
        const isPng = file.endsWith('.png');
        const isManifest = file.endsWith('.atlas.json');
        if (!file.startsWith(bobsRoot + sep) || (!isPng && !isManifest) || !existsSync(file)) {
          next();
          return;
        }
        res.setHeader('Content-Type', isPng ? 'image/png' : 'application/json');
        createReadStream(file).pipe(res);
      });
    },
  };
}

function serveContentTextures(): Plugin {
  return {
    name: 'vinland-serve-content-textures',
    configureServer(server) {
      server.middlewares.use('/textures', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        const file = normalize(resolve(texturesRoot, rel));
        if (!file.startsWith(texturesRoot + sep) || !file.endsWith('.png') || !existsSync(file)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'image/png');
        createReadStream(file).pipe(res);
      });
    },
  };
}

function serveContentIr(): Plugin {
  return {
    name: 'vinland-serve-content-ir',
    configureServer(server) {
      server.middlewares.use('/ir.json', (_req, res, next) => {
        if (!existsSync(irFile)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        createReadStream(irFile).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    serveMapsIndex(),
    serveContentMaps(),
    serveContentBobs(),
    serveContentTextures(),
    serveContentIr(),
  ],
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist' },
});
