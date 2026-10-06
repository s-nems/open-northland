import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { countGlCalls } from './bench-browser-profile.mjs';
import { repoRoot } from './content-dir.mjs';

/**
 * Paused world screenshots of a checkpoint at fixed cameras, for comparing a render change pixel by
 * pixel, and the comparison itself.
 *
 *   npm run bench:browser-shots -- capture <checkpoint> <origin> <out-dir>
 *   npm run bench:browser-shots -- compare <dir-a> <dir-b>
 *
 * A capture restores the checkpoint paused, frames the densest building cluster at zoom 1, 0.5, 0.35
 * and 2, and writes `<view>.png` plus `report.json` (draws and texture binds per frame). With
 * `ON_BENCH_SHOT_STEPS=n` it steps the paused sim n ticks before each screenshot, a frame after each,
 * so per-tick render paths run while the picture stays reproducible. The pointer rests on the bottom
 * HUD bar, where no world hover card can rise. With `ON_BENCH_BROWSER_SEAT=n` the spectator watches
 * that seat, so the shots draw through its fog and sight. A compare prints, per view, the differing pixels and
 * the largest channel difference, decoded in the browser so no image dependency is needed.
 */

const [command, ...args] = process.argv.slice(2);
const VIEWPORT = { width: 1440, height: 900 };
const VIEWS = { dense: 1, zoom05: 0.5, wide: 0.35, magnify: 2 };

async function capture(checkpoint, origin, outDir) {
  const saveText = await readFile(checkpoint, 'utf8');
  const { header } = JSON.parse(saveText);
  const stamp = header.session;
  const params = new URLSearchParams({
    map: header.mapId,
    player: 'observer',
    ai: stamp.aiSeats.length === 1 ? `${stamp.aiSeats[0]},` : stamp.aiSeats.join(','),
    seed: String(header.seed),
    fog: 'classic',
    zoom: '1',
    uiscale: '1',
    fullscreen: 'off',
  });
  if (typeof stamp.tribes === 'string' && stamp.tribes !== '') params.set('tribes', stamp.tribes);
  for (const key of ['progression', 'needs'])
    if (typeof stamp[key] === 'boolean') params.set(key, stamp[key] ? 'on' : 'off');
  const steps = Number(process.env.ON_BENCH_SHOT_STEPS ?? '0');
  const seat =
    process.env.ON_BENCH_BROWSER_SEAT === undefined ? null : Number(process.env.ON_BENCH_BROWSER_SEAT);
  if (seat !== null && !Number.isInteger(seat)) throw new Error('ON_BENCH_BROWSER_SEAT must be a seat');
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--mute-audio'] });
  const report = { checkpoint: resolve(checkpoint), steps, seat, views: {}, errors: [] };
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(async (text) => {
      const { storePendingLoad } = await import('/src/view/runtime/save-load/pending-store.ts');
      await storePendingLoad(new TextEncoder().encode(text), false);
    }, saveText);
    await page.goto(new URL(`?${params}`, origin).href);
    await page.waitForFunction((tick) => window.__opennorthland?.host.tick === tick, header.tick, {
      timeout: 180000,
    });
    await page.evaluate(() => window.__opennorthland.setPaused(true));
    if (seat !== null)
      await page.evaluate((watched) => {
        const watch = window.__opennorthland.watchSeat;
        if (watch === null) throw new Error('The session has no seat picker to watch a seat with');
        watch(watched);
      }, seat);
    const dense = await page.evaluate(
      async (modules) => {
        const { ONE } = await import(modules.fixed);
        const { tileToScreen } = await import(modules.projection);
        const points = window.__opennorthland.host
          .snapshot()
          .entities.filter((e) => e.components.Building && e.components.Position)
          .map((e) => tileToScreen(e.components.Position.x / ONE, e.components.Position.y / ONE));
        let best = points[0] ?? { x: 0, y: 0 };
        let count = -1;
        for (const p of points) {
          const n = points.filter((q) => Math.abs(q.x - p.x) < 650 && Math.abs(q.y - p.y) < 380).length;
          if (n > count) {
            count = n;
            best = p;
          }
        }
        return best;
      },
      {
        fixed: `/@fs${resolve(repoRoot, 'packages/sim/src/core/fixed.ts')}`,
        projection: `/@fs${resolve(repoRoot, 'packages/render/src/data/projection/iso.ts')}`,
      },
    );
    await page.evaluate(() => window.__opennorthland.cameraCtl.setSuspended(true));
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 3);
    for (const [view, scale] of Object.entries(VIEWS)) {
      const camera = {
        scale,
        offsetX: VIEWPORT.width / 2 - dense.x * scale,
        offsetY: VIEWPORT.height / 2 - dense.y * scale,
      };
      await page.evaluate((c) => window.__opennorthland.cameraCtl.jumpTo(c), camera);
      await page.waitForTimeout(1500);
      for (let i = 0; i < steps; i++) {
        await page.evaluate(async () => {
          await window.__opennorthland.host.run(1);
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
      }
      await countGlCalls(page);
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(outDir, `${view}.png`) });
      report.views[view] = await page.evaluate(() => window.__glCalls.report());
      console.log(`bench:browser-shots ${view}: ${Math.round(report.views[view].drawsPerFrame)} draws`);
    }
  } finally {
    await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  if (report.errors.length > 0) throw new Error(`browser errors: ${report.errors.join('; ')}`);
}

async function compare(dirA, dirB) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const view of Object.keys(VIEWS)) {
      const [a, b] = await Promise.all(
        [dirA, dirB].map(async (dir) => (await readFile(resolve(dir, `${view}.png`))).toString('base64')),
      );
      const result = await page.evaluate(
        async ({ a, b }) => {
          const pixels = async (data) => {
            const image = await createImageBitmap(
              await (await fetch(`data:image/png;base64,${data}`)).blob(),
            );
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, image.width, image.height).data;
          };
          const [pa, pb] = await Promise.all([pixels(a), pixels(b)]);
          if (pa.length !== pb.length) return { differing: -1, maxDelta: -1 };
          let differing = 0;
          let maxDelta = 0;
          for (let i = 0; i < pa.length; i += 4) {
            let delta = 0;
            for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(pa[i + c] - pb[i + c]));
            if (delta > 0) differing++;
            maxDelta = Math.max(maxDelta, delta);
          }
          return { differing, maxDelta };
        },
        { a, b },
      );
      console.log(`${view}: ${result.differing} pixels differ, max delta ${result.maxDelta}/255`);
    }
  } finally {
    await browser.close();
  }
}

if (command === 'capture' && args.length === 3) await capture(args[0], args[1], args[2]);
else if (command === 'compare' && args.length === 2) await compare(args[0], args[1]);
else
  throw new Error(
    'usage: bench:browser-shots -- capture <checkpoint> <origin> <out-dir> | compare <dir-a> <dir-b>',
  );
