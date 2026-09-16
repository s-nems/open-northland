import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import type { z } from 'zod';
import { buildTools, cachedBuild } from './build-cache.js';
import type { reportSchema } from './build-report.js';
import { loadAsset } from './catalog.js';
import { packCharacter } from './character.js';
import { fingerprint, hashes, writeJson } from './files.js';
import { inputHashes } from './inputs.js';
import { lock } from './lock.js';
import { inside, sourcePath } from './paths.js';
import { type Frame, renderRaster } from './raster.js';
import { exists } from './transaction.js';
import { validateDelivery } from './validate.js';

export async function buildAsset(root: string, id: string, options: { force?: boolean } = {}) {
  const started = performance.now();
  let checkpoint = started;
  const timings: Record<string, number> = {};
  function measure(stage: string) {
    const now = performance.now();
    timings[stage] = now - checkpoint;
    checkpoint = now;
  }
  const base = join(root, '.art-build');
  await mkdir(base, { recursive: true });
  const destination = inside(base, id);
  const release = await lock(join(destination, 'build.lock'));
  try {
    const asset = await loadAsset(root, id);
    const before = await inputHashes(root, asset);
    const raster = asset.recipe.outputs.some((o) => o.content.operation === 'raster');
    const tools = await buildTools(raster);
    measure('inputs');
    const cached = options.force
      ? { reason: 'forced rebuild' }
      : await cachedBuild(
          destination,
          id,
          before,
          tools,
          asset.recipe.outputs.map((o) => o.path),
        );
    measure('freshness');
    async function verifyInputs() {
      const latest = await loadAsset(root, id);
      const after = await inputHashes(root, latest);
      if (
        latest.path !== asset.path ||
        JSON.stringify(latest.recipe) !== JSON.stringify(asset.recipe) ||
        fingerprint(before) !== fingerprint(after)
      )
        throw new Error('Inputs changed during build');
      if (fingerprint(tools) !== fingerprint(await buildTools(raster)))
        throw new Error('Tools changed during build');
    }
    let report: z.infer<typeof reportSchema>;
    if (cached.report) {
      await verifyInputs();
      measure('recheck');
      report = cached.report;
    } else report = await buildLocked();
    return {
      ...report,
      execution: {
        status: cached.report ? 'skipped' : 'built',
        reason: cached.reason,
        timings,
        total: performance.now() - started,
      },
    };

    async function buildLocked() {
      const temporary = await mkdtemp(join(base, 'build-')),
        delivery = join(temporary, 'delivery');
      await mkdir(delivery);
      let browser: Browser | undefined;
      try {
        if (raster) browser = await chromium.launch({ headless: true });
        measure('browser');
        const frames = new Map<string, Frame[]>(),
          characters = new Map<string, unknown>();
        const operations: unknown[] = [];
        const rasterJobs = asset.recipe.outputs.flatMap((o) =>
          o.content.operation === 'raster' ? [{ path: o.path, recipe: o.content }] : [],
        );
        const rasters = new Map(
          (browser ? await renderRaster(browser, root, asset.directory, rasterJobs) : []).map((r) => [
            r.path,
            r,
          ]),
        );
        for (const output of asset.recipe.outputs) {
          const path = inside(delivery, output.path);
          await mkdir(dirname(path), { recursive: true });
          const c = output.content;
          if (c.operation === 'copy')
            await writeFile(path, await readFile(await sourcePath(root, asset.directory, c.source)));
          else if (c.operation === 'raster') {
            if (!browser) throw new Error('Raster backend unavailable');
            const result = rasters.get(output.path);
            if (!result) throw new Error('Missing raster result');
            await writeFile(path, Buffer.from(result.png, 'base64'));
            frames.set(output.path, result.frames);
            operations.push({ path: output.path, crops: result.crops, alpha: result.alpha });
          } else if (c.operation === 'character') {
            const result = await packCharacter(asset.directory, c.source, c.id, c.name, c.shadow);
            await writeFile(path, result.png);
            characters.set(`${dirname(output.path)}/runtime.json`, result.manifest);
            const m = result.manifest;
            const bodyRgbaBytes = m.width * m.height * 4;
            const shadowRgbaBytes = m.shadow ? m.shadow.width * m.shadow.height * 4 : 0;
            operations.push({
              path: output.path,
              bodyRgbaBytes,
              shadowRgbaBytes,
              totalRgbaBytes: bodyRgbaBytes + shadowRgbaBytes,
            });
          }
        }
        for (const output of asset.recipe.outputs) {
          const c = output.content;
          if (c.operation !== 'json') continue;
          const generated = characters.get(output.path);
          const f = c.framesFrom === undefined ? undefined : frames.get(c.framesFrom);
          if (c.framesFrom !== undefined && (!f || f.length === 0))
            throw new Error(`Missing generated frames: ${c.framesFrom}`);
          await writeJson(
            inside(delivery, output.path),
            generated ?? { ...c.value, ...(f ? { frames: f } : {}) },
          );
        }
        measure('processing');
        const validation = await validateDelivery(delivery);
        measure('validation');
        const files = await hashes(delivery);
        await verifyInputs();
        measure('hashing');
        const report = {
          version: 2 as const,
          id,
          inputs: before,
          files,
          digest: fingerprint(files),
          tools,
          chromiumVersion: browser?.version() ?? null,
          operations,
          validation,
        };
        await writeJson(join(temporary, 'report.json'), report);
        const version = join(destination, report.digest);
        if (await exists(version)) {
          const backup = await mkdtemp(join(base, 'replaced-'));
          await rm(backup, { recursive: true });
          await rename(version, backup);
          try {
            await rename(temporary, version);
          } catch (error) {
            await rename(backup, version);
            throw error;
          }
          await rm(backup, { recursive: true, force: true });
        } else await rename(temporary, version);
        await writeJson(join(destination, 'current.json'), { digest: report.digest });
        measure('writing');
        return report;
      } finally {
        await browser?.close();
        await rm(temporary, { recursive: true, force: true });
      }
    }
  } finally {
    await release();
  }
}
