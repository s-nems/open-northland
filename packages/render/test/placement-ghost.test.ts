import { Graphics, Sprite, Texture, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../src/data/terrain/index.js';
import { PlacementGhostLayer } from '../src/gpu/overlays/placement-ghost.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../src/index.js';

/**
 * The build cursor ghost mints its stack through the same resolver a placed building uses, so it previews
 * what will draw. The fixture's fake TextureSource is never sampled.
 */
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const source = {} as TextureSource;
const BODY_BOB = 70;
const HOUSE_TYPE = 13;
const VIKING = 1;
const SARACEN = 4;
const SARACEN_BOB = 12;
const atlas: SpriteAtlas = {
  width: 100,
  height: 10,
  frames: new Map([
    [BODY_BOB, { x: 0, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -10 }],
    [SARACEN_BOB, { x: 20, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -10 }],
  ]),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: {
      byType: { [HOUSE_TYPE]: { layer: 'houses', bob: BODY_BOB } },
      default: BODY_BOB,
      byTribe: {
        [VIKING]: { byType: { [HOUSE_TYPE]: { layer: 'houses', bob: BODY_BOB } } },
        [SARACEN]: { byType: { [HOUSE_TYPE]: { layer: 'houses', bob: SARACEN_BOB } } },
      },
    },
  },
  families: { houses: { source, atlas } },
  familyScales: { houses: 2 }, // a non-unit scale so the offset*scale / scale.set steps are pinned
};

describe('PlacementGhostLayer', () => {
  it('mints the building body sprite at its resolved layer offset and scale', () => {
    const layer = new PlacementGhostLayer(sheet, new TextureCache());
    layer.set({ kind: 'building', col: 4, row: 6, buildingType: HOUSE_TYPE, tribe: VIKING }, FLAT);
    expect(layer.container.visible).toBe(true);
    expect(layer.container.children).toHaveLength(1);
    const spr = layer.container.children[0];
    expect(spr).toBeInstanceOf(Sprite);
    if (!(spr instanceof Sprite)) throw new Error('expected a sprite');
    expect(spr.position.x).toBe(-10); // frame.offsetX (-5) * scale (2)
    expect(spr.position.y).toBe(-20); // frame.offsetY (-10) * scale (2)
    expect(spr.scale.x).toBe(2);
  });

  it('previews the holder civilization body, so the cursor matches what the placement puts down', () => {
    const layer = new PlacementGhostLayer(sheet, new TextureCache());
    layer.set({ kind: 'building', col: 4, row: 6, buildingType: HOUSE_TYPE, tribe: SARACEN }, FLAT);
    const spr = layer.container.children[0];
    if (!(spr instanceof Sprite)) throw new Error('expected a sprite');
    expect(spr.texture.frame.x).toBe(20); // the saracen bob, not the viking one at x 0
    // The cached stack is keyed by tribe too, so switching seats rebuilds rather than reusing the body.
    layer.set({ kind: 'building', col: 4, row: 6, buildingType: HOUSE_TYPE, tribe: VIKING }, FLAT);
    const viking = layer.container.children[0];
    if (!(viking instanceof Sprite)) throw new Error('expected a sprite');
    expect(viking.texture.frame.x).toBe(0);
  });

  it('falls back to a placeholder diamond when no sheet resolves a frame', () => {
    const layer = new PlacementGhostLayer(undefined, new TextureCache());
    layer.set({ kind: 'building', col: 4, row: 6, buildingType: HOUSE_TYPE, tribe: VIKING }, FLAT);
    expect(layer.container.children).toHaveLength(1);
    expect(layer.container.children[0]).toBeInstanceOf(Graphics);
  });

  it('stakes the open and blocked nodes of a line and lets the string pass the built ones', () => {
    const stakes = { open: new Texture(), blocked: new Texture(), ring: new Texture() };
    const layer = new PlacementGhostLayer(sheet, new TextureCache(), stakes);
    layer.set(
      {
        kind: 'line',
        anchored: true,
        nodes: [
          { col: 4, row: 6, state: 'built' },
          { col: 5, row: 6, state: 'open' },
          { col: 6, row: 6, state: 'blocked' },
        ],
      },
      FLAT,
    );
    const [string, ...marks] = layer.container.children;
    expect(string).toBeInstanceOf(Graphics);
    expect(marks.map((mark) => (mark instanceof Sprite ? mark.texture : null))).toEqual([
      stakes.open,
      stakes.blocked,
    ]);
  });
});
