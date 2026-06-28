// The committed screenshot harness — `npm run shot` (see docs/TESTING.md "Visual validation via
// Playwright"). It boots the app's deterministic, headless render entry (`?shot`), waits on the
// `window.__vinlandShotReady` flag the entry sets after drawing ONE frame, and writes a PNG an agent
// (or a human) eyeballs for GROSS correctness — never auto-passed, never byte-compared (the GPU
// rasteriser isn't byte-stable across machines; the sim is, the pixels aren't).
//
// Reproducible because: the sim is seed-deterministic and `buildScene` is pure, so `?shot&seed&ticks`
// always feeds the renderer the same draw list. This is a committed script (not the Playwright MCP)
// so it lives in the repo, runs in CI, and can later graduate to golden-image diffs.
//
// Usage:  node packages/app/scripts/shot.mjs [--seed N] [--ticks N] [--map id] [--atlas] [--out path.png]
//         npm run shot -- --seed 7 --ticks 20 --out shot.png
//         npm run shot -- --map oasis_o_plenty   # draw an actual decoded content/maps/<id>.json grid
//         npm run shot -- --atlas                # bind the free synthetic atlas (textured sprites)
//         npm run shot -- --atlas real           # bind the REAL decoded human-body atlas (needs content/)
//         npm run shot -- --atlas real --zoom 5  # magnify + centre on the sprites (judge decoded pixels)
//         npm run shot -- --map <id> --terrain   # draw the ground from REAL decoded text_*.pcx (needs content/)

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** A boolean CLI flag — present (`--atlas`) vs absent. */
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const seed = arg('seed', '7');
const ticks = arg('ticks', '20');
const mapId = arg('map', '');
// `--atlas` alone = the synthetic atlas; `--atlas real` = the real decoded human atlas. Guard against
// `--atlas` immediately followed by another flag (e.g. `--atlas --out x`) reading the flag as a value.
const atlasRaw = flag('atlas') ? arg('atlas', 'synthetic') : '';
const atlasMode = atlasRaw.startsWith('--') ? 'synthetic' : atlasRaw;
const zoom = arg('zoom', '');
const terrain = flag('terrain');
const noHud = flag('no-hud');
const outPath = resolve(process.cwd(), arg('out', 'shot.png'));

async function main() {
  // Boot the app's own Vite dev server (no separate build needed). `root` is the app package so it
  // serves index.html + main.ts exactly as `npm run dev` does.
  const server = await createServer({
    root: appRoot,
    server: { port: 0, open: false },
    logLevel: 'warn',
  });
  await server.listen();
  const { port } = server.config.server;
  const address = server.httpServer?.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  const mapParam = mapId ? `&map=${encodeURIComponent(mapId)}` : '';
  const atlasParam = atlasMode ? `&atlas=${encodeURIComponent(atlasMode)}` : '';
  const zoomParam = zoom ? `&zoom=${encodeURIComponent(zoom)}` : '';
  const terrainParam = terrain ? '&terrain' : '';
  const hudParam = noHud ? '&hud=0' : '';
  const url = `http://localhost:${resolvedPort}/?shot&seed=${seed}&ticks=${ticks}${mapParam}${atlasParam}${zoomParam}${terrainParam}${hudParam}`;

  const browser = await chromium.launch();
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(url, { waitUntil: 'load' });
    // Wait for the headless render entry to draw its single frame and raise the ready flag. If it
    // never does (a render crash before the flag), surface the collected page errors — otherwise the
    // bare timeout masks the real cause.
    try {
      await page.waitForFunction(() => window.__vinlandShotReady === true, { timeout: 30_000 });
    } catch (e) {
      if (errors.length > 0) {
        console.error('shot: page errored before the ready flag was set:');
        for (const err of errors) console.error(`  - ${err}`);
      }
      throw e;
    }

    await mkdir(dirname(outPath), { recursive: true });
    const canvas = page.locator('#game');
    await canvas.screenshot({ path: outPath });

    if (errors.length > 0) {
      console.error(`shot: page reported ${errors.length} error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
      failed = true;
    }
    console.log(
      `shot: wrote ${outPath} (seed=${seed}, ticks=${ticks}${mapId ? `, map=${mapId}` : ''}) from ${url}`,
    );
    console.log('shot: NOT auto-passed — a human/agent must eyeball the PNG for gross correctness.');
  } finally {
    await browser.close();
    await server.close();
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error('shot: failed:', e);
  process.exit(1);
});
