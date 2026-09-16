// Capture the deterministic ?shot entry after its ready flag; fail on page errors.
// Inputs are reproducible, GPU pixels are not guaranteed byte-identical. Inspect the PNG.
// Usage and options: docs/DEVELOPMENT.md, Screenshots.

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

/** A boolean CLI flag - present (`--atlas`) vs absent. */
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
    server: { host: '127.0.0.1', port: 0, open: false },
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
  const url = `http://127.0.0.1:${resolvedPort}/?shot&seed=${seed}&ticks=${ticks}${mapParam}${atlasParam}${zoomParam}${terrainParam}${hudParam}`;

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
    // never does (a render crash before the flag), surface the collected page errors - otherwise the
    // bare timeout masks the real cause.
    try {
      await page.waitForFunction(() => window.__opennorthlandShotReady === true, { timeout: 30_000 });
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
    console.log('shot: NOT auto-passed - a human/agent must eyeball the PNG for gross correctness.');
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
