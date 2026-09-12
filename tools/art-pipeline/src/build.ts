import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import sharp from 'sharp';
import { loadAsset } from './catalog.js';
import { packCharacter } from './character.js';
import { fingerprint, hashes, writeJson } from './files.js';
import { inputHashes } from './inputs.js';
import { lock } from './lock.js';
import { inside, sourcePath } from './paths.js';
import { type Frame, renderRaster } from './raster.js';
import { exists } from './transaction.js';
import { validateDelivery } from './validate.js';

export async function buildAsset(root: string, id: string) {
  const asset = await loadAsset(root, id),
    before = await inputHashes(root, asset);
  const base = join(root, '.art-build');
  await mkdir(base, { recursive: true });
  const destination = inside(base, id);
  const release = await lock(join(destination, 'build.lock'));
  try {
    return await buildLocked();
  } finally {
    await release();
  }
  async function buildLocked() {
    const temporary = await mkdtemp(join(base, 'build-')),
      delivery = join(temporary, 'delivery');
    await mkdir(delivery);
    let browser: Browser | undefined;
    try {
      if (asset.recipe.outputs.some((o) => o.content.operation === 'raster'))
        browser = await chromium.launch({ headless: true });
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
      const validation = await validateDelivery(delivery);
      const files = await hashes(delivery);
      const after = await inputHashes(root, asset);
      if (fingerprint(before) !== fingerprint(after)) throw new Error('Inputs changed during build');
      const report = {
        version: 1,
        id,
        inputs: before,
        files,
        digest: fingerprint(files),
        tools: { node: process.version, chromium: browser?.version() ?? null, sharp: sharp.versions },
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
      return report;
    } finally {
      await browser?.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
