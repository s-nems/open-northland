import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { characterShadow } from '../src/character-shadow.js';
import { writeJson } from '../src/files.js';
import { validateDelivery } from '../src/validate.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const shadow = {
  sprite: 'shadow.png',
  width: 16,
  height: 4,
  cellWidth: 2,
  cellHeight: 2,
  columns: 8,
  anchorX: 1,
  anchorY: 1,
};

it('rejects a retained shadow after its motion source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shadow-source-'));
  roots.push(root);
  await writeFile(join(root, 'motion.glb'), 'synthetic motion');
  await writeJson(join(root, 'shadow.json'), {
    ...shadow,
    basis: 'Synthetic projection',
    inputs: {
      'motion.glb': createHash('sha256').update('synthetic motion').digest('hex'),
    },
  });
  expect((await characterShadow(root, 'shadow.json')).manifest).toEqual(shadow);
  await writeFile(join(root, 'motion.glb'), 'new motion');
  await expect(characterShadow(root, 'shadow.json')).rejects.toThrow('Stale character shadow');
});

it('validates separate character shadow delivery and rejects missing or wrong-sized PNGs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shadow-delivery-'));
  roots.push(root);
  const folder = join(root, 'characters/test');
  await mkdir(folder, { recursive: true });
  await writeJson(join(folder, 'runtime.json'), {
    id: 'test',
    name: 'Test',
    width: 8,
    height: 2,
    cellWidth: 1,
    cellHeight: 1,
    columns: 8,
    anchorX: 0,
    anchorY: 1,
    scale: 1,
    walkFrames: 1,
    idleFrames: 1,
    walkDuration: 1,
    idleDuration: 1,
    sourceBasis: 'Synthetic fixture',
    shadow,
  });
  const png = async (file: string, width: number, height: number) => {
    const pixels = Buffer.alloc(width * height * 4);
    pixels[3] = 80;
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(file);
  };
  await png(join(folder, 'atlas.png'), 8, 2);
  await expect(validateDelivery(root)).rejects.toThrow('Missing image');
  await png(join(folder, 'shadow.png'), 8, 2);
  await expect(validateDelivery(root)).rejects.toThrow('Image dimensions disagree');
  await png(join(folder, 'shadow.png'), 16, 4);
  await expect(validateDelivery(root)).resolves.toMatchObject({ files: 3, bindings: 1 });
});
