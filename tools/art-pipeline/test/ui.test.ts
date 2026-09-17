import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { writeJson } from '../src/files.js';
import { recipeSchema } from '../src/recipe.js';
import { validateDelivery } from '../src/validate.js';
import { fixture } from './delivery-fixture.js';

const CELL = 2;
const COLUMNS = 2;

describe('ui chrome delivery', () => {
  it('accepts a ui recipe kind', () => {
    expect(() =>
      recipeSchema.parse({
        version: 1,
        id: 'ui/foundation',
        kind: 'ui',
        sourceBasis: 'Synthetic fixture',
        outputs: [
          { path: 'ui/foundation/surface.png', content: { operation: 'copy', source: 'surface.png' } },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects missing, mis-sized, empty-cell and misidentified ui images', async () => {
    const f = await fixture();
    const folder = join(f.runtime, 'ui/foundation');
    await mkdir(folder, { recursive: true });
    const manifest = {
      id: 'foundation',
      surface: { file: 'surface.png', width: 3, height: 2 },
      icons: {
        file: 'icons.png',
        width: 4,
        height: 4,
        cell: CELL,
        columns: COLUMNS,
        names: ['build', 'mission', 'knowledge'],
      },
      sourceBasis: 'Synthetic fixture',
    };
    await writeJson(join(folder, 'runtime.json'), manifest);
    await expect(validateDelivery(f.runtime)).rejects.toThrow('Missing');
    await sharp({ create: { width: 3, height: 2, channels: 3, background: '#553322' } })
      .png()
      .toFile(join(folder, 'surface.png'));
    const pixels = Buffer.alloc(4 * 4 * 4);
    // One opaque pixel in each of the three named cells; the fourth cell stays empty and unnamed.
    const opaque: readonly (readonly [x: number, y: number])[] = [
      [0, 0],
      [2, 0],
      [0, 2],
    ];
    for (const [x, y] of opaque) pixels.fill(255, (y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
    await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } })
      .png()
      .toFile(join(folder, 'icons.png'));
    await expect(validateDelivery(f.runtime)).resolves.toBeDefined();
    await writeJson(join(folder, 'runtime.json'), {
      ...manifest,
      icons: { ...manifest.icons, names: [...manifest.icons.names, 'diplomacy'] },
    });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('Empty icon cell');
    await writeJson(join(folder, 'runtime.json'), {
      ...manifest,
      surface: { ...manifest.surface, width: 4 },
    });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('dimensions');
    await writeJson(join(folder, 'runtime.json'), { ...manifest, id: 'other' });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('folder');
  });
});
