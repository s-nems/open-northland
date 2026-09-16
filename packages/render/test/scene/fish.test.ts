import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { buildSpriteScene, resolveLayers, type SpriteAtlas, type SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

const source = {} as TextureSource;
const frame = (bob: number) =>
  [bob, { x: bob, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -5 }] as const;

describe('fish swarm rendering', () => {
  it('classifies a persistent FishSwarm as a fish draw item at its water position', () => {
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: 12, continent: 3, shore: 8 } })]),
    );
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({ kind: 'fish', ref: 7 });
  });

  it('does not draw a depleted persistent swarm', () => {
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: 0, continent: 3, shore: 8 } })]),
    );
    expect(scene).toEqual([]);
  });

  it('draws the source fish headings from their dedicated ls_fishes family', () => {
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
      snapshotOf([entity(2, 0, 0, { FishSwarm: { count: 1, continent: 0, shore: 1 } })]),
    )[0];
    if (item === undefined) throw new Error('fish item missing');
    expect(resolveLayers(sheet, item, 0)?.map((layer) => layer.frame.x)).toEqual([0]);
    expect(resolveLayers(sheet, item, 4)?.map((layer) => layer.frame.x)).toEqual([1]);
  });
});
