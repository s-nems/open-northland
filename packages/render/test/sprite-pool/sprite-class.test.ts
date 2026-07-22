import type { TextureSource } from 'pixi.js';
import { Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import type { SpriteAtlas, SpriteSheet } from '../../src/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * The pool's sprite-class decision, headless half: a settler binds team-coloured PalettedSprite meshes
 * only when BOTH the indexed characters and the player-colour LUT are loaded; with characters but no
 * LUT it must bind plain {@link Sprite}s through its character layers. The mesh half is not pinned here:
 * a PalettedSprite needs a DOM canvas to construct (Pixi probes fragment precision), so it stays covered
 * by the browser scenes.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const source = {} as TextureSource;

const BODY_BOB = 1;
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};
/** A one-character sheet without a palette LUT: every job resolves to the same body at idle. */
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: { settler: BODY_BOB, resource: 1, building: 1 },
  characters: { byJob: {}, default: { body: { source, atlas }, binding: { idle: BODY_BOB } } },
};

function poolFrame(snapshot: ReturnType<typeof snapshotOf>): PoolFrame {
  return {
    snapshot,
    viewport: VIEW_ALL,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
  };
}

describe('SpritePool — the sprite-class decision without a LUT', () => {
  it('binds a character settler as plain Sprites and stamps its drawn bounds', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    pool.reconcile(poolFrame(snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })])));

    const container = layer.children[0] as Container;
    const sprites = container.children;
    expect(sprites.length).toBeGreaterThan(0); // the character body bound, not the placeholder
    for (const spr of sprites) expect(spr).toBeInstanceOf(Sprite);
    const bounds = pool.boundsOf(1);
    if (bounds === undefined) throw new Error('a drawn settler must stamp bounds');
    expect(bounds.maxY - bounds.minY).toBe(32); // the body frame's rect, feet-anchored
  });
});
