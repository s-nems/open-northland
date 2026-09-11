import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOwnBuildingLayers } from '../src/content/own-assets/building-layers.js';
import { ownBuildingManifest } from '../src/content/own-assets/building-manifest.js';

const mocks = vi.hoisted(() => ({ texture: vi.fn(), pixels: vi.fn() }));
vi.mock('pixi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pixi.js')>()),
  Assets: { load: mocks.texture },
}));
vi.mock('../src/content/net.js', () => ({ fetchImageData: mocks.pixels }));

const manifest = ownBuildingManifest.parse({
  tribeId: 1,
  typeId: 1,
  layer: 'fixture',
  sprite: 'body.png',
  width: 2,
  height: 1,
  scale: 1,
  entrancePixel: { x: 1, y: 1 },
  doorNode: { x: 0, y: 0 },
  sourceBasis: 'Synthetic construction fixture',
  construction: [{ sprite: 'body.png', timeMask: 'time.png', fromPct: 0, toPct: 100 }],
});

beforeEach(() => {
  mocks.texture.mockReset().mockResolvedValue({ width: 2, height: 1, source: {} });
  mocks.pixels.mockReset().mockResolvedValue({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
  });
});

describe('own construction layer loading', () => {
  it('keeps the final body untimed and the stage aligned with its mask', async () => {
    const layers = await loadOwnBuildingLayers(manifest, (name) => `/assets/${name}`);
    expect(layers.fixture?.times).toBeUndefined();
    expect(layers['fixture-construction-0']?.times?.values).toEqual(new Uint8Array([0, 255]));
    expect(layers['fixture-construction-0']?.atlas).toEqual(layers.fixture?.atlas);
  });
  it('rejects missing or mismatched masks instead of binding an unmasked finished body as a stage', async () => {
    await expect(
      loadOwnBuildingLayers(manifest, (name) => (name === 'time.png' ? undefined : name)),
    ).rejects.toThrow('mask');
    mocks.pixels.mockResolvedValue({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
    await expect(loadOwnBuildingLayers(manifest, (name) => name)).rejects.toThrow('mask');
  });
  it('rejects artwork with a different canvas before publishing layers', async () => {
    mocks.texture.mockResolvedValue({ width: 3, height: 1, source: {} });
    await expect(loadOwnBuildingLayers(manifest, (name) => name)).rejects.toThrow('dimensions');
  });
});
