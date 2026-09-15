// The menu-backdrop capture harness - `npm run menu-backdrops`. It boots the app's `?backdrop=<map>`
// entry (one ambient-settlement frame, no HUD, ready flag like `?shot`) for each curated framing
// below, writes JPEG stills into `content/backdrops/` and lists them in `content/backdrops-index.json`,
// which the menu's rotation reads. The stills contain decoded original art, so they live in the
// gitignored `content/` tree and NEVER enter the repository; re-run this script after `npm run pipeline`.
//
// Usage:  npm run menu-backdrops
//         node packages/app/scripts/menu-backdrops.mjs [--only <mapId>] [--out <dir>]

import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

// The curated framings: authored settlements that read well at the menu's grade, eyeballed for
// variety (village, coast, snow, jungle, river) and for no map edge in frame. `zoom`, `ticks` and
// `focus=x,y` plumb straight into the `?backdrop` entry when a map's default framing is off.
const SHOTS = [
  { map: 'demo_mainmenu_10' },
  { map: 'mroczny_swiat' },
  { map: 'saracen_4' },
  { map: 'kraina_starych_bohaterow' },
  { map: 'burza_piaskowa' },
  { map: 'straznicypolnocy' },
  { map: 'wielka_inwazja' },
  { map: 'nowa_nadzieja' },
];

/** Capture size: the menu's 1080p design frame; `cover` scaling absorbs other viewports. */
const VIEWPORT = { width: 1920, height: 1080 };
const JPEG_QUALITY = 85;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const only = arg('only', '');
const outDir = resolve(process.cwd(), arg('out', resolve(appRoot, '../../content/backdrops')));
/** The listing the menu fetches, beside the stills directory it names. */
const indexFile = resolve(outDir, '..', 'backdrops-index.json');

/** Every still in the folder, in code-unit order, so a partial `--only` run lists the whole set. */
async function writeIndex() {
  const files = (await readdir(outDir)).filter((file) => file.endsWith('.jpg')).sort();
  await writeFile(indexFile, `${JSON.stringify(files, null, 2)}\n`);
  console.log(`menu-backdrops: listed ${files.length} still(s) in ${indexFile}`);
}

async function main() {
  const shots = only ? SHOTS.filter((s) => s.map === only) : SHOTS;
  if (shots.length === 0) {
    console.error(`menu-backdrops: no curated shot named "${only}"`);
    process.exit(1);
  }

  const server = await createServer({
    root: appRoot,
    server: { port: 0, open: false },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : server.config.server.port;

  await mkdir(outDir, { recursive: true });
  // Full runs own the folder: stale stills from dropped curations must not linger in the rotation.
  if (!only) {
    for (const file of await readdir(outDir)) {
      if (file.endsWith('.jpg')) await unlink(join(outDir, file));
    }
  }

  const browser = await chromium.launch();
  let failures = 0;
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    for (const shot of shots) {
      const extras = [
        shot.zoom !== undefined ? `&zoom=${shot.zoom}` : '',
        shot.ticks !== undefined ? `&ticks=${shot.ticks}` : '',
        shot.focus !== undefined ? `&focus=${shot.focus}` : '',
      ].join('');
      const url = `http://localhost:${port}/?backdrop=${encodeURIComponent(shot.map)}${extras}`;
      errors.length = 0;
      try {
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__opennorthlandShotReady === true, { timeout: 60_000 });
        // An errored capture must not ride the rotation: skip the write, not just the exit code.
        if (errors.length > 0) {
          console.error(`menu-backdrops: ${shot.map} skipped, page error(s):`);
          for (const e of errors) console.error(`  - ${e}`);
          failures += 1;
          continue;
        }
        // Number by the shot's place in SHOTS, not the filtered list: an `--only` re-capture must
        // overwrite its full-run file instead of minting a second copy under a new index.
        const file = join(outDir, `${String(SHOTS.indexOf(shot) + 1).padStart(2, '0')}-${shot.map}.jpg`);
        await page.locator('#game').screenshot({ path: file, type: 'jpeg', quality: JPEG_QUALITY });
        console.log(`menu-backdrops: wrote ${file}`);
      } catch (e) {
        console.error(`menu-backdrops: ${shot.map} failed: ${e}`);
        for (const err of errors) console.error(`  - ${err}`);
        failures += 1;
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  await writeIndex();
  console.log('menu-backdrops: stills are gitignored content - eyeball them before trusting the set.');
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('menu-backdrops: failed:', e);
  process.exit(1);
});
