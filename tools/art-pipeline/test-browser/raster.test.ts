import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderRaster } from '../src/raster.js';
import { raster } from '../src/recipe.js';

let browser: Browser;
let root: string;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  root = await mkdtemp(join(tmpdir(), 'art-raster-'));
  await mkdir(join(root, 'source'));
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 4; y < 12; y++)
    for (let x = 4; x < 12; x++) pixels.set([200, 80, 30, x === 4 ? 128 : 255], (y * 16 + x) * 4);
  await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } })
    .png()
    .toFile(join(root, 'source/master.png'));
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#00000000' } })
    .png()
    .toFile(join(root, 'source/empty.png'));
});
afterAll(async () => {
  await browser?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
const job = (sampling = 'canvas-high') => ({
  operation: 'raster',
  sampling,
  width: 16,
  height: 16,
  alpha: 'transparent',
  draws: [
    {
      source: 'master.png',
      alphaBounds: true,
      box: [2, 2, 8, 8],
      fit: 'contain',
      round: true,
      frameAnchor: { x: 0.5, y: 1 },
    },
  ],
});
describe('raster backends', () => {
  for (const sampling of ['canvas-high', 'lanczos3']) {
    it(`${sampling} retains alpha, bounds, source scale and frame anchors`, async () => {
      const output = await renderRaster(browser, root, join(root, 'source'), [
        { path: 'test.png', recipe: raster.parse(job(sampling)) },
      ]);
      const image = output[0];
      expect(image).toBeDefined();
      if (!image) throw new Error('Missing image');
      expect(image.crops).toEqual([[2, 2, 12, 12]]);
      expect(image.frames).toEqual([{ x: 2, y: 2, width: 8, height: 8, anchor: { x: 4, y: 8 } }]);
      expect(image.alpha.zero).toBeGreaterThan(0);
      expect(image.alpha.partial).toBeGreaterThan(0);
      const png = await sharp(Buffer.from(image.png, 'base64')).metadata();
      expect([png.width, png.height, png.hasAlpha]).toEqual([16, 16, true]);
    });
  }
  it('rejects empty cells, out-of-source crops, upscaling and nonopaque materials', async () => {
    const cases = [
      { ...job(), draws: [{ source: 'empty.png', alphaBounds: true, box: [0, 0, 8, 8] }] },
      { ...job(), draws: [{ source: 'master.png', crop: [10, 10, 8, 8], box: [0, 0, 8, 8] }] },
      { ...job(), width: 32, height: 32, draws: [{ source: 'master.png', box: [0, 0, 32, 32] }] },
      { ...job(), alpha: 'opaque' },
    ];
    for (const value of cases)
      await expect(
        renderRaster(browser, root, join(root, 'source'), [
          { path: 'test.png', recipe: raster.parse(value) },
        ]),
      ).rejects.toThrow();
  });
  it('repeats a batch with identical decoded pixels', async () => {
    const jobs = [
      { path: 'a.png', recipe: raster.parse(job()) },
      { path: 'b.png', recipe: raster.parse(job('lanczos3')) },
    ];
    const first = await renderRaster(browser, root, join(root, 'source'), jobs),
      second = await renderRaster(browser, root, join(root, 'source'), jobs);
    expect(first.map((r) => r.png)).toEqual(second.map((r) => r.png));
  });
});
