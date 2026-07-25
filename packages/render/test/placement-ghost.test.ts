import { Graphics, Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../src/data/terrain/index.js';
import { PlacementGhostLayer } from '../src/gpu/overlays/placement-ghost.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../src/index.js';

/**
 * The build cursor ghost mints the held building's own sprite stack through the exact resolver a placed
 * building uses, so it previews what will draw; with no sheet it degrades to a placeholder diamond. The
 * fixture's fake TextureSource is never sampled (headless), so what these pin is the stack construction.
 */
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const source = {} as TextureSource;
const BODY_BOB = 70;
const HOUSE_TYPE = 13;
const atlas: SpriteAtlas = {
  width: 100,
  height: 10,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -10 }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: { byType: { [HOUSE_TYPE]: { layer: 'houses', bob: BODY_BOB } }, default: BODY_BOB },
  },
  families: { houses: { source, atlas } },
  familyScales: { houses: 2 }, // a non-unit scale so the offset*scale / scale.set steps are pinned
};

describe('PlacementGhostLayer', () => {
  it('mints the building body sprite at its resolved layer offset and scale', () => {
    const layer = new PlacementGhostLayer(sheet, new TextureCache());
    layer.set({ kind: 'building', col: 4, row: 6, buildingType: HOUSE_TYPE }, FLAT);
    expect(layer.container.visible).toBe(true);
    expect(layer.container.children).toHaveLength(1);
    const spr = layer.container.children[0];
    expect(spr).toBeInstanceOf(Sprite);
    if (!(spr instanceof Sprite)) throw new Error('expected a sprite');
    expect(spr.position.x).toBe(-10); // frame.offsetX (-5) * scale (2)
    expect(spr.position.y).toBe(-20); // frame.offsetY (-10) * scale (2)
    expect(spr.scale.x).toBe(2);
  });

  it('falls back to a placeholder diamond when no sheet resolves a frame', () => {
    const layer = new PlacementGhostLayer(undefined, new TextureCache());
    layer.set({ kind: 'building', col: 4, row: 6, buildingType: HOUSE_TYPE }, FLAT);
    expect(layer.container.children).toHaveLength(1);
    expect(layer.container.children[0]).toBeInstanceOf(Graphics);
  });
});
