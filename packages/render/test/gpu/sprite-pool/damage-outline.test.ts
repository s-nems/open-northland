import { Container, Rectangle, type Sprite, Texture, TextureSource } from 'pixi.js';
import { afterEach, expect, it, vi } from 'vitest';
import type { Viewport } from '../../../src/data/projection/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { BuildingDamage } from '../../../src/gpu/building-damage/building-damage.js';
import { OutlineSprite } from '../../../src/gpu/selection/sprite-effect.js';
import { type PoolFrame, SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import type { SpriteSheet } from '../../../src/gpu/textures/sprite-sheet.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

/** A hovered house's outline copies its body texture, which the damage paint swaps for a tile it
 *  releases once the house is whole again; the outline must not keep sampling that tile. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const HOUSE = 1;
const BODY_BOB = 70;
const MAX_HP = 100;
const HURT_HP = 50;

afterEach(() => {
  vi.restoreAllMocks();
});

function frameOf(snapshot: ReturnType<typeof snapshotOf>, hovered = true): PoolFrame {
  return {
    snapshot,
    viewport: ALL,
    tick: snapshot.tick,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    ...(hovered ? { hovered: HOUSE } : {}),
  };
}

it('lays a hovered house outline off its own body once a repair releases the damage tile', () => {
  const source = new TextureSource({ width: 64, height: 64 });
  const atlas = {
    width: 64,
    height: 64,
    frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 32, height: 32, offsetX: -16, offsetY: -32 }]]),
  };
  const sheet: SpriteSheet = { source, atlas, bindings: { settler: 1, resource: 1, building: BODY_BOB } };
  // Stands in for the damage paint: a hurt body draws from its own tile, released on repair.
  const tiles = new Map<number, { body: Sprite; original: Texture; tile: Texture }>();
  vi.spyOn(BuildingDamage.prototype, 'draw').mockImplementation((damaged, subjectOf) => {
    const hurt = new Set(damaged.map((item) => item.ref));
    for (const ref of hurt) {
      const body = subjectOf(ref)?.damageBodies?.[0];
      if (body === undefined || tiles.has(ref)) continue;
      const tile = new Texture({ source, frame: new Rectangle(32, 0, 32, 32) });
      tiles.set(ref, { body, original: body.texture, tile });
      body.texture = tile;
    }
    for (const [ref, { body, original, tile }] of tiles) {
      if (hurt.has(ref)) continue;
      body.texture = original;
      tile.destroy();
      tiles.delete(ref);
    }
  });
  const layer = new Container();
  const textures = new TextureCache();
  const pool = new SpritePool(layer, textures, sheet);
  const house = (hitpoints: number) =>
    snapshotOf([entity(HOUSE, 3, 3, { Building: {}, Health: { hitpoints, max: MAX_HP } })]);
  const hurt = house(HURT_HP);
  pool.reconcile(frameOf(hurt, false));
  // The hover starts over the painted body, then the repair lands without a new bind.
  pool.reconcile(frameOf(hurt));
  const released = tiles.get(HOUSE)?.tile;
  expect(released).toBeDefined();
  pool.reconcile(frameOf(house(MAX_HP)));
  expect(released?.destroyed).toBe(true);
  const outline = layer.children[0]?.children[0];
  const quads = outline?.children.filter((c): c is OutlineSprite => c instanceof OutlineSprite) ?? [];
  const laid = quads.filter((quad) => quad.alpha > 0);
  expect(laid.length).toBeGreaterThan(0);
  for (const quad of laid) {
    expect(quad.bodyTexture.destroyed).toBe(false);
    expect(quad.texture.destroyed).toBe(false);
  }
  pool.destroy();
  textures.clear();
  source.destroy();
});
