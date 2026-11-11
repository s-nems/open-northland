import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  cameraAt,
  checkpointSession,
  densestBuildings,
  openBenchBrowser,
  openBenchPage,
  restoreCheckpoint,
  VIEWPORT,
} from '../../browser/session.mjs';
import { parseGraphicsKnobs } from './frames-plan.mjs';
import { countGlCalls } from './profile.mjs';

/**
 * Paused world screenshots of a checkpoint at fixed cameras, for comparing a render change pixel by
 * pixel, and the comparison itself.
 *
 *   npm run bench:browser-shots -- capture <checkpoint> <origin> <out-dir>
 *   npm run bench:browser-shots -- compare <dir-a> <dir-b>
 *
 * A capture restores the checkpoint paused, frames the densest building cluster at zoom 1, 0.7, 0.5,
 * 0.35 and 2, and writes `<view>.png` plus `report.json` (draws and texture binds per frame). With
 * `ON_BENCH_SHOT_STEPS=n` it steps the paused sim n ticks before each screenshot, a frame after each,
 * so per-tick render paths run while the picture stays reproducible. The pointer rests on the bottom
 * HUD bar, where no world hover card can rise. With `ON_BENCH_BROWSER_SEAT=n` the spectator watches
 * that seat, so the shots draw through its fog and sight. A compare prints, per view, the differing pixels and
 * the largest channel difference, decoded in the browser so no image dependency is needed.
 */

const [command, ...args] = process.argv.slice(2);
const VIEWS = { dense: 1, zoom07: 0.7, zoom05: 0.5, wide: 0.35, magnify: 2 };

async function capture(checkpoint, origin, outDir) {
  const saveText = await readFile(checkpoint, 'utf8');
  const { header, stateHash, params } = checkpointSession(JSON.parse(saveText));
  const steps = Number(process.env.ON_BENCH_SHOT_STEPS ?? '0');
  const seat =
    process.env.ON_BENCH_BROWSER_SEAT === undefined ? null : Number(process.env.ON_BENCH_BROWSER_SEAT);
  if (seat !== null && !Number.isInteger(seat)) throw new Error('ON_BENCH_BROWSER_SEAT must be a seat');
  await mkdir(outDir, { recursive: true });
  const browser = await openBenchBrowser({ args: ['--mute-audio'] });
  const report = { checkpoint: resolve(checkpoint), steps, seat, views: {}, errors: [] };
  try {
    const page = await openBenchPage(browser);
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.goto(origin);
    const url = new URL(`?${params}`, origin).href;
    // Only the detail knob: every other setting stays what the harness seeds.
    const { adaptiveDetail } = parseGraphicsKnobs(process.env).settings;
    await restoreCheckpoint(page, { saveText, header, stateHash, url, settings: { adaptiveDetail } });
    if (seat !== null)
      await page.evaluate((watched) => {
        const watch = window.__opennorthland.watchSeat;
        if (watch === null) throw new Error('The session has no seat picker to watch a seat with');
        watch(watched);
      }, seat);
    const dense = (await densestBuildings(page)).point;
    await page.evaluate(() => window.__opennorthland.cameraCtl.setSuspended(true));
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 3);
    for (const [view, scale] of Object.entries(VIEWS)) {
      await page.evaluate((c) => window.__opennorthland.cameraCtl.jumpTo(c), cameraAt(dense, scale));
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
  const browser = await openBenchBrowser({ headless: true, args: [] });
  try {
    const page = await browser.newPage();
    for (const view of Object.keys(VIEWS)) {
      const [a, b] = await Promise.all(
        [dirA, dirB].map(async (dir) =>
          (await readFile(resolve(dir, `${view}.png`)).catch(() => null))?.toString('base64'),
        ),
      );
      if (a === undefined || b === undefined) {
        console.log(`${view}: not in both captures`);
        continue;
      }
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
