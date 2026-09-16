import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { buildAsset } from '../src/build.js';
import * as cache from '../src/build-cache.js';
import { candidate } from '../src/candidate.js';
import { json, writeJson } from '../src/files.js';
import * as validation from '../src/validate.js';
import { fixture } from './delivery-fixture.js';

describe('art build freshness', () => {
  it('retains a valid candidate without processing or rewriting it; force rebuilds', async () => {
    const f = await fixture();
    const first = await buildAsset(f.root, f.id);
    const directory = join(f.root, '.art-build', f.id, first.digest);
    const marker = join(directory, 'review.html');
    await writeFile(marker, 'retained review');
    const before = await stat(join(directory, 'report.json'));
    const validate = vi.spyOn(validation, 'validateDelivery');
    const second = await buildAsset(f.root, f.id);
    expect(second.execution.status).toBe('skipped');
    expect(second.digest).toBe(first.digest);
    expect(validate).not.toHaveBeenCalled();
    expect(await readFile(marker, 'utf8')).toBe('retained review');
    expect((await stat(join(directory, 'report.json'))).mtimeMs).toBe(before.mtimeMs);
    expect(second.execution.total).toBeGreaterThan(0);
    const forced = await buildAsset(f.root, f.id, { force: true });
    expect(forced.execution.status).toBe('built');
    expect(forced.execution.reason).toBe('forced rebuild');
    expect(validate).toHaveBeenCalledOnce();
    expect(forced.digest).toBe(first.digest);
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips a raster candidate before launching Chromium', async () => {
    const f = await fixture();
    await writeJson(join(f.source, 'asset.json'), {
      ...f.recipe,
      outputs: [
        {
          path: 'buildings/home/home.png',
          content: {
            operation: 'raster',
            width: 4,
            height: 4,
            alpha: 'transparent',
            draws: [{ source: 'home.png', box: [0, 0, 4, 4] }],
          },
        },
        f.recipe.outputs[1],
      ],
    });
    await buildAsset(f.root, f.id);
    const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('Must not start'));
    expect((await buildAsset(f.root, f.id)).execution.status).toBe('skipped');
    expect(launch).not.toHaveBeenCalled();
    await expect(buildAsset(f.root, f.id, { force: true })).rejects.toThrow('Must not start');
    await candidate(f.root, f.id);
  });

  it('detects changed source pixels even when their modification time is restored', async () => {
    const f = await fixture();
    const first = await buildAsset(f.root, f.id);
    const path = join(f.source, 'home.png');
    const previous = await stat(path);
    const pixels = Buffer.alloc(4 * 4 * 4);
    pixels.set([50, 200, 100, 255], 4 * 4);
    await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } })
      .png()
      .toFile(path);
    await utimes(path, previous.atime, previous.mtime);
    const changed = await buildAsset(f.root, f.id);
    expect(changed.execution.status).toBe('built');
    expect(changed.digest).not.toBe(first.digest);
  });

  it.each([
    'asset.json',
    'tool source',
    'contracts',
    'lockfile',
  ])('rebuilds after changing %s', async (dependency) => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    const path =
      dependency === 'asset.json'
        ? join(f.source, dependency)
        : join(
            f.root,
            dependency === 'tool source'
              ? 'tools/art-pipeline/src/change.ts'
              : dependency === 'contracts'
                ? 'packages/art-contracts/src/change.ts'
                : 'package-lock.json',
          );
    if (dependency === 'asset.json') await writeJson(path, { ...f.recipe, sourceBasis: 'Changed recipe' });
    else await writeFile(path, '{}\n');
    const changed = await buildAsset(f.root, f.id);
    expect(changed.execution.status).toBe('built');
    expect(changed.execution.reason).toContain('inputs');
    expect((await buildAsset(f.root, f.id)).execution.status).toBe('skipped');
  });

  it('rebuilds when the tool environment changes', async () => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    const tools = await cache.buildTools(false);
    vi.spyOn(cache, 'buildTools').mockResolvedValue({ ...tools, node: 'changed-version' });
    const changed = await buildAsset(f.root, f.id);
    expect(changed.execution.status).toBe('built');
    expect(changed.execution.reason).toBe('tool environment changed');
  });

  it.each([
    'changed',
    'missing',
    'extra',
    'report',
    'pointer',
    'version',
  ])('repairs %s candidate data', async (damage) => {
    const f = await fixture();
    const first = await buildAsset(f.root, f.id);
    const base = join(f.root, '.art-build', f.id);
    const directory = join(base, first.digest);
    const png = join(directory, 'delivery/buildings/home/home.png');
    if (damage === 'changed') await writeFile(png, 'broken');
    if (damage === 'missing') await rm(png);
    if (damage === 'extra') await writeFile(join(directory, 'delivery/extra.png'), 'extra');
    if (damage === 'report') await writeFile(join(directory, 'report.json'), '{');
    if (damage === 'pointer') await writeJson(join(base, 'current.json'), { digest: '../escape' });
    if (damage === 'version') await writeJson(join(directory, 'report.json'), { ...first, version: 1 });
    const repaired = await buildAsset(f.root, f.id);
    expect(repaired.execution.status).toBe('built');
    expect((await candidate(f.root, f.id)).report.digest).toBe(first.digest);
  });

  it('rejects changes during the freshness check and releases the build lock', async () => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    const original = cache.cachedBuild;
    vi.spyOn(cache, 'cachedBuild').mockImplementationOnce(async (...args) => {
      const cached = await original(...args);
      await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 0.75 });
      return cached;
    });
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('Inputs changed during build');
    expect((await buildAsset(f.root, f.id)).execution.status).toBe('built');
  });

  it('does not treat filesystem errors or an active lock as cache misses', async () => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    const base = join(f.root, '.art-build', f.id);
    await mkdir(join(base, 'build.lock'));
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('Operation locked');
    await rm(join(base, 'build.lock'), { recursive: true });
    await rm(join(base, 'current.json'));
    await mkdir(join(base, 'current.json'));
    await expect(buildAsset(f.root, f.id)).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(json(join(base, 'build.lock/owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
