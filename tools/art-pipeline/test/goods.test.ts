import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { writeJson } from '../src/files.js';
import { validateDelivery } from '../src/validate.js';
import { fixture } from './delivery-fixture.js';

describe('goods delivery', () => {
  it('rejects missing, opaque, mis-sized and misidentified goods images', async () => {
    const f = await fixture();
    const folder = join(f.runtime, 'goods/wood');
    await mkdir(folder, { recursive: true });
    const manifest = {
      id: 'wood',
      image: 'atlas.png',
      width: 12,
      height: 2,
      scale: 0.5,
      frames: Array.from({ length: 6 }, (_, i) => ({
        x: i * 2,
        y: 0,
        width: 2,
        height: 2,
        anchor: { x: 1, y: 1 },
      })),
      sourceBasis: 'Synthetic fixture',
    };
    await writeJson(join(folder, 'runtime.json'), manifest);
    await expect(validateDelivery(f.runtime)).rejects.toThrow('Missing image');
    await sharp({ create: { width: 12, height: 2, channels: 4, background: '#ffffff' } })
      .png()
      .toFile(join(folder, 'atlas.png'));
    await expect(validateDelivery(f.runtime)).rejects.toThrow('alpha');
    const pixels = Buffer.alloc(12 * 2 * 4);
    for (let i = 0; i < 6; i++) pixels.fill(255, i * 8, i * 8 + 4);
    await sharp(pixels, { raw: { width: 12, height: 2, channels: 4 } })
      .png()
      .toFile(join(folder, 'atlas.png'));
    await expect(validateDelivery(f.runtime)).resolves.toBeDefined();
    await writeJson(join(folder, 'runtime.json'), { ...manifest, width: 13 });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('dimensions');
    await writeJson(join(folder, 'runtime.json'), { ...manifest, id: 'stone' });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('folder');
  });
});
