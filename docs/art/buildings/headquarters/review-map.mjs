import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const output = resolve('content/local-headquarters-inverted-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  await page.goto(
    'http://127.0.0.1:5173/?map=magiczny_las&assets=own&intro=off&zoom=2&center=40,40&fog=off&sound=off',
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  );
  await page.waitForFunction(() => window.__opennorthland?.perf().tick > 2, null, { timeout: 60000 });
  const start = await page.evaluate(() => window.__opennorthland.perf().tick);
  await page.waitForFunction((t) => window.__opennorthland.perf().tick > t + 30, start, { timeout: 30000 });
  const report = await page.evaluate(() => {
    const debug = window.__opennorthland;
    debug.setPaused(true);
    return {
      perf: debug.perf(),
      families: Object.keys(debug.sheet.families),
      familyScales: debug.sheet.familyScales,
      buildings: debug.sim.snapshot().entities.filter((e) => e.components.Building?.buildingType === 1),
      camera: debug.cameraCtl.camera(),
    };
  });
  await page.evaluate(() => window.__opennorthland.renderer.app.render());
  await page.screenshot({ path: resolve(output, 'map.png') });
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ errors, warnings, report }, null, 2));
  console.log(
    JSON.stringify({
      errors,
      warnings,
      tick: report.perf.tick,
      headquarters: report.families.filter((f) => f.includes('headquarters')),
      screenshot: resolve(output, 'map.png'),
    }),
  );
} finally {
  await browser.close();
}
