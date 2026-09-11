import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { approve } from '../src/approval.js';
import { buildAsset } from '../src/build.js';
import { candidate } from '../src/candidate.js';
import { hashes, writeJson } from '../src/files.js';
import { presentationDigest } from '../src/presentation.js';
import { publish } from '../src/publish.js';
import { recipeSchema } from '../src/recipe.js';
import { recover } from '../src/transaction.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'art-pipeline-'));
  roots.push(root);
  const source = join(root, 'docs/art/buildings/home');
  await mkdir(source, { recursive: true });
  for (const folder of [
    'tools/art-pipeline/src',
    'packages/art-contracts/src',
    'packages/app/src/assets/own',
  ])
    await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, 'package-lock.json'), '{}');
  const manifest = {
    tribeId: 1,
    typeId: 1,
    layer: 'own-home',
    sprite: 'home.png',
    width: 4,
    height: 4,
    scale: 0.5,
    entrancePixel: { x: 2, y: 3 },
    doorNode: { x: 0, y: 0 },
    sourceBasis: 'Synthetic fixture',
  };
  const pixels = Buffer.alloc(4 * 4 * 4);
  pixels.set([200, 100, 50, 255], 4 * 4);
  await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } })
    .png()
    .toFile(join(source, 'home.png'));
  await writeJson(join(source, 'runtime.json'), manifest);
  const recipe = {
    version: 1,
    id: 'buildings/home',
    kind: 'building',
    sourceBasis: 'Synthetic fixture',
    outputs: [
      { path: 'buildings/home/home.png', content: { operation: 'copy', source: 'home.png' } },
      { path: 'buildings/home/runtime.json', content: { operation: 'copy', source: 'runtime.json' } },
    ],
  };
  await writeJson(join(source, 'asset.json'), recipe);
  await writeJson(join(root, 'docs/art/assets.json'), {
    version: 1,
    assets: [{ id: recipe.id, recipe: 'docs/art/buildings/home/asset.json' }],
  });
  await writeJson(join(root, 'docs/art/approvals.json'), {});
  await writeJson(join(root, 'docs/art/delivery.json'), {});
  return {
    root,
    source,
    manifest,
    recipe,
    id: recipe.id,
    runtime: join(root, 'packages/app/src/assets/own'),
  };
}
async function reviewed(root: string, id: string) {
  await buildAsset(root, id);
  const c = await candidate(root, id);
  await approve(root, id, await presentationDigest(c.delivery), 'test reviewer');
  return c;
}
describe('art delivery', () => {
  it('builds without touching runtime, publishes an approved complete candidate and repeats safely', async () => {
    const f = await fixture();
    const before = await hashes(f.runtime);
    const c = await reviewed(f.root, f.id);
    expect(await hashes(f.runtime)).toEqual(before);
    await publish(f.root, f.id);
    expect(await hashes(f.runtime)).toEqual(c.report.files);
    await publish(f.root, f.id);
    expect(await hashes(f.runtime)).toEqual(c.report.files);
  });
  it('rejects an unreviewed candidate and a review for another digest', async () => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    await expect(publish(f.root, f.id)).rejects.toThrow('visual approval');
    await expect(approve(f.root, f.id, '0'.repeat(64), 'reviewer')).rejects.toThrow('does not match');
    expect(await hashes(f.runtime)).toEqual({});
  });
  it('rejects source changes and edited build output', async () => {
    const f = await fixture();
    const c = await reviewed(f.root, f.id);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 0.75 });
    await expect(publish(f.root, f.id)).rejects.toThrow('stale');
    await writeJson(join(f.source, 'runtime.json'), f.manifest);
    await writeFile(join(c.delivery, 'buildings/home/home.png'), 'broken');
    await expect(publish(f.root, f.id)).rejects.toThrow('bytes changed');
  });
  it('invalidates visual approval for calibration changes', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 0.75 });
    await buildAsset(f.root, f.id);
    await expect(publish(f.root, f.id)).rejects.toThrow('visual approval');
  });
  it('does not overwrite a file owned by another asset or an unregistered file', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await mkdir(join(f.runtime, 'buildings/home'), { recursive: true });
    await writeFile(join(f.runtime, 'buildings/home/home.png'), 'existing');
    await expect(publish(f.root, f.id)).rejects.toThrow('unowned');
    await rm(join(f.runtime, 'buildings/home/home.png'));
    await writeJson(join(f.root, 'docs/art/delivery.json'), {
      'buildings/other': ['buildings/home/home.png'],
    });
    await expect(publish(f.root, f.id)).rejects.toThrow('belongs to');
  });
  it('validates the combined pack before replacing the current delivery', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    const other = join(f.runtime, 'buildings/other');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'home.png'), await readFile(join(f.source, 'home.png')));
    await writeJson(join(other, 'runtime.json'), f.manifest);
    const before = await hashes(f.runtime);
    await expect(publish(f.root, f.id)).rejects.toThrow('Duplicate binding');
    expect(await hashes(f.runtime)).toEqual(before);
  });
  it('removes only obsolete owned files and retains unrelated valid assets', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await publish(f.root, f.id);
    await writeFile(join(f.runtime, 'buildings/home/retired.png'), 'obsolete');
    await writeJson(join(f.root, 'docs/art/delivery.json'), {
      [f.id]: ['buildings/home/home.png', 'buildings/home/runtime.json', 'buildings/home/retired.png'],
    });
    const other = join(f.runtime, 'buildings/other');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'home.png'), await readFile(join(f.source, 'home.png')));
    await writeJson(join(other, 'runtime.json'), { ...f.manifest, typeId: 2, layer: 'other' });
    const before = await hashes(other);
    await publish(f.root, f.id);
    expect(await hashes(other)).toEqual(before);
    await expect(readFile(join(f.runtime, 'buildings/home/retired.png'))).rejects.toThrow();
  });
  it('recovers an interrupted directory swap and its ownership registry', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await publish(f.root, f.id);
    const before = await hashes(f.runtime);
    const registry = await readFile(join(f.root, 'docs/art/delivery.json'), 'utf8'),
      base = join(f.root, '.art-build/publication');
    await mkdir(base, { recursive: true });
    await rename(f.runtime, join(base, 'previous'));
    await mkdir(f.runtime);
    await writeFile(join(f.runtime, 'partial'), 'bad');
    await writeJson(join(f.root, 'docs/art/delivery.json'), {});
    await writeJson(join(base, 'journal.json'), { phase: 'swapped', registry });
    await recover(f.root);
    expect(await hashes(f.runtime)).toEqual(before);
    expect(await readFile(join(f.root, 'docs/art/delivery.json'), 'utf8')).toBe(registry);
  });
  it('rejects path traversal, duplicate outputs and escaping source symlinks', async () => {
    const f = await fixture();
    expect(() =>
      recipeSchema.parse({
        ...f.recipe,
        outputs: [{ path: '../escape.png', content: { operation: 'copy', source: 'home.png' } }],
      }),
    ).toThrow();
    expect(() =>
      recipeSchema.parse({ ...f.recipe, outputs: [...f.recipe.outputs, ...f.recipe.outputs] }),
    ).toThrow();
    const external = await mkdtemp(join(tmpdir(), 'art-external-'));
    roots.push(external);
    await writeFile(join(external, 'image.png'), 'external');
    await rm(join(f.source, 'home.png'));
    await symlink(join(external, 'image.png'), join(f.source, 'home.png'));
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('outside repository');
  });
  it('keeps approval stable across JSON formatting changes', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await writeFile(join(f.source, 'runtime.json'), JSON.stringify(f.manifest));
    await buildAsset(f.root, f.id);
    await publish(f.root, f.id);
    expect(Object.keys(await hashes(f.runtime))).toHaveLength(2);
  });
});

describe('candidate and recovery lifecycle', () => {
  it('rebuilding repairs corrupted candidate bytes', async () => {
    const f = await fixture();
    const c = await reviewed(f.root, f.id);
    await writeFile(join(c.delivery, 'buildings/home/home.png'), 'corrupted');
    await buildAsset(f.root, f.id);
    expect((await candidate(f.root, f.id)).report.digest).toBe(c.report.digest);
  });
  it('a failed rebuild preserves the previous candidate', async () => {
    const f = await fixture();
    const c = await reviewed(f.root, f.id);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, width: 8 });
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('dimensions');
    expect(await hashes(c.delivery)).toEqual(c.report.files);
    await writeJson(join(f.source, 'runtime.json'), f.manifest);
    expect((await candidate(f.root, f.id)).report.digest).toBe(c.report.digest);
  });
  it('recovery refuses to interrupt a live publishing process', async () => {
    const f = await fixture();
    await writeJson(join(f.root, '.art-build/publish.lock/owner.json'), { pid: process.pid });
    await expect(recover(f.root)).rejects.toThrow('still running');
    expect(await readFile(join(f.root, '.art-build/publish.lock/owner.json'), 'utf8')).toContain(
      String(process.pid),
    );
  });
});
