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
  it('aligns a larger shadow canvas without changing body bounds or construction layers', async () => {
    const shadow = { sprite: 'shadow.png', width: 5, height: 3, entrancePixel: { x: 3, y: 2 } };
    mocks.texture.mockImplementation(async (url: string) => ({
      width: url.endsWith('shadow.png') ? 5 : 2,
      height: url.endsWith('shadow.png') ? 3 : 1,
      source: {},
    }));
    const layers = await loadOwnBuildingLayers({ ...manifest, shadow }, (name) => name);
    const body = layers.fixture;
    const frame = body?.atlas.frames.get(0);
    const ground = body?.shadow?.atlas.frames.get(0);
    expect(frame).toMatchObject({ width: 2, height: 1, offsetX: -1, offsetY: -1 });
    expect(ground).toMatchObject({ width: 5, height: 3, offsetX: -3, offsetY: -2 });
    expect(ground?.selectionEllipse).toBeUndefined();
    expect(layers['fixture-construction-0']?.shadow).toBeUndefined();
  });
  it('rejects missing or mismatched shadow before returning a partial building', async () => {
    const withGround = {
      ...manifest,
      shadow: { sprite: 'shadow.png', width: 5, height: 3, entrancePixel: { x: 3, y: 2 } },
    };
    await expect(
      loadOwnBuildingLayers(withGround, (name) => (name === 'shadow.png' ? undefined : name)),
    ).rejects.toThrow('Missing sprite shadow.png');
    await expect(loadOwnBuildingLayers(withGround, (name) => name)).rejects.toThrow('dimensions');
  });
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

describe('own overlay sheet loading', () => {
  const overlay = {
    sprite: 'rotor.png',
    frameWidth: 4,
    frameHeight: 2,
    frames: 3,
    columns: 2,
    scale: 0.5,
    bodyPixel: { x: 1, y: 0 },
    idle: 0,
    working: [0, 1, 2],
    ticksPerFrame: 1,
  };
  it('loads the sheet as a separate frame-indexed layer beside the body', async () => {
    mocks.texture.mockImplementation(async (url: string) => ({
      width: url.endsWith('rotor.png') ? 8 : 2,
      height: url.endsWith('rotor.png') ? 4 : 1,
      source: { url },
    }));
    const layers = await loadOwnBuildingLayers({ ...manifest, overlay }, (name) => name);
    const sheet = layers['fixture-overlay'];
    expect(sheet?.atlas.frames.size).toBe(3);
    expect(sheet?.atlas.frames.get(2)).toMatchObject({ x: 0, y: 2, width: 4, height: 2 });
    expect(sheet?.source).toMatchObject({ url: 'rotor.png' });
    expect(layers.fixture?.atlas.frames.size).toBe(1);
  });
  it('rejects a sheet whose image does not hold every frame', async () => {
    mocks.texture.mockImplementation(async (url: string) => ({
      width: url.endsWith('rotor.png') ? 8 : 2,
      height: url.endsWith('rotor.png') ? 2 : 1,
      source: {},
    }));
    await expect(loadOwnBuildingLayers({ ...manifest, overlay }, (name) => name)).rejects.toThrow(
      'dimensions',
    );
  });
});
