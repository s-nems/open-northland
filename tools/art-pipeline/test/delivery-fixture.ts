import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, vi } from 'vitest';
import { approve } from '../src/approval.js';
import { buildAsset } from '../src/build.js';
import { candidate } from '../src/candidate.js';
import { writeJson } from '../src/files.js';
import { presentationDigest } from '../src/presentation.js';

export const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'art-pipeline-'));
  roots.push(root);
  const source = join(root, 'docs/art/buildings/home');
  await mkdir(source, { recursive: true });
  for (const folder of [
    'tools/art-pipeline/src',
    'packages/art-contracts/src',
    'packages/app/src/assets/custom',
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
    runtime: join(root, 'packages/app/src/assets/custom'),
  };
}
export async function reviewed(root: string, id: string) {
  await buildAsset(root, id);
  const c = await candidate(root, id);
  await approve(root, id, await presentationDigest(c.delivery), 'test reviewer');
  return c;
}
