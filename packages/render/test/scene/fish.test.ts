import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { fishHeadingIndex } from '../../src/gpu/sprite-pool/resolve-layers.js';
import { buildSpriteScene, resolveLayers, type SpriteAtlas, type SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const source = {} as TextureSource;
const frame = (bob: number) =>
  [bob, { x: bob, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -5 }] as const;

describe('fish swarm rendering', () => {
  it('maps cardinal velocity to the fish sheet descending directional order', () => {
    expect(fishHeadingIndex(1, 0, 18)).toBe(0);
    expect(fishHeadingIndex(0, 1, 18)).toBe(13);
    expect(fishHeadingIndex(-1, 0, 18)).toBe(9);
    expect(fishHeadingIndex(0, -1, 18)).toBe(4);
  });

  it('classifies a persistent FishSwarm as a fish draw item at its water position', () => {
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: 12, continent: 3, shore: 8 } })]),
    );
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({ kind: 'fish', ref: 7, swarmCount: 12 });
  });

  it('does not draw a depleted persistent swarm', () => {
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: 0, continent: 3, shore: 8 } })]),
    );
    expect(scene).toEqual([]);
  });

  it('draws every fish in the stock as an independently moving source heading', () => {
    const atlas: SpriteAtlas = { width: 18, height: 10, frames: new Map([frame(0), frame(1)]) };
    const sheet: SpriteSheet = {
      source,
      atlas: { width: 0, height: 0, frames: new Map() },
      bindings: {
        settler: 1,
        building: 1,
        resource: 1,
        fish: { layer: 'ls_fishes.butterfly01', bobs: [0, 1], ticksPerFrame: 4 },
      },
      families: { 'ls_fishes.butterfly01': { source, atlas } },
    };
    const item = buildSpriteScene(
      snapshotOf([entity(2, 0, 0, { FishSwarm: { count: 6, continent: 0, shore: 1 } })]),
    )[0];
    if (item === undefined) throw new Error('fish item missing');
    const first = resolveLayers(sheet, item, 0);
    const later = resolveLayers(sheet, item, 4);
    expect(first).toHaveLength(6);
    expect(first?.every((layer) => layer.frame.x === 0 || layer.frame.x === 1)).toBe(true);
    expect(new Set(first?.map((layer) => `${layer.dx},${layer.dy}`)).size).toBe(6);
    expect(later?.map((layer) => [layer.dx, layer.dy])).not.toEqual(
      first?.map((layer) => [layer.dx, layer.dy]),
    );
    const next = resolveLayers(sheet, item, 1);
    const greatestStep = Math.max(
      ...(first?.map((layer, i) =>
        Math.hypot(
          (next?.[i]?.dx ?? layer.dx ?? 0) - (layer.dx ?? 0),
          (next?.[i]?.dy ?? layer.dy ?? 0) - (layer.dy ?? 0),
        ),
      ) ?? []),
    );
    expect(greatestStep).toBeLessThan(2);
  });
});
