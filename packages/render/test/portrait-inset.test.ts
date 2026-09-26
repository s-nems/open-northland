import { type Application, Container, type Rectangle } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../src/data/projection/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import { type PortraitInsetFrame, PortraitInsetLayer } from '../src/gpu/overlays/portrait-inset.js';
import { SpritePool } from '../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * The portrait insets: each frame paints its own cutout after the main render, a rider is framed off the
 * vehicle it sits on, and a box with nothing to frame still gets its floor so the map never shows
 * through it.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const EVERYTHING: Viewport = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };
const GROUND = 0x336633;
const BOX = { x: 40, y: 30, w: 96, h: 92 };
const SETTLER = 1;
const CART = 2;
const HOUSE = 3;

interface Pass {
  readonly frame: Rectangle;
  readonly x: number;
  readonly visibleChildren: number;
}

function harness() {
  const world = new Container();
  const sprites = new Container();
  world.addChild(sprites);
  const passes: Pass[] = [];
  const app = {
    screen: { width: 800, height: 600 },
    renderer: {
      render: (opts: { frame: Rectangle }) =>
        passes.push({
          frame: opts.frame,
          x: world.position.x,
          visibleChildren: world.children.filter((c) => c.visible).length,
        }),
    },
  } as unknown as Application;
  const pool = new SpritePool(sprites, new TextureCache(), undefined);
  // The rider draws no figure of its own: only the cart and a house stand in the scene.
  pool.reconcile({
    snapshot: snapshotOf([entity(CART, 4, 4, { Vehicle: {} }), entity(HOUSE, 8, 4, { Building: {} })]),
    viewport: EVERYTHING,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    snapResolution: 1,
  });
  const layer = new PortraitInsetLayer(app, world, pool);
  const terrain = { toInset: () => undefined, restore: () => undefined, backdrop: GROUND };
  return { world, pool, passes, layer, terrain };
}

describe('PortraitInsetLayer', () => {
  it('frames a rider off the vehicle it sits on', () => {
    const { pool, passes, layer, terrain } = harness();
    const cart = pool.anchorOf(CART);
    if (cart === undefined) throw new Error('expected the cart drawn');
    layer.set([{ rect: BOX, entityRef: SETTLER, kind: 'settler', aboard: CART }]);
    layer.draw(CAMERA, terrain);
    expect(passes).toHaveLength(1);
    const scale = BOX.h / 58;
    expect(passes[0]?.x).toBeCloseTo(BOX.w / 2 - cart.x * scale);
    expect(layer.subjects()).toEqual({ ref: SETTLER, house: null, others: [CART] });
  });

  it('floors a box it cannot frame instead of leaving the map under it exposed', () => {
    const { passes, layer, terrain } = harness();
    layer.set([{ rect: BOX, entityRef: SETTLER, kind: 'settler' }]);
    layer.draw(CAMERA, terrain);
    expect(passes).toHaveLength(1);
    expect(passes[0]?.frame).toMatchObject({ x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h });
    // Only the floor quad draws: every world layer is hidden for the pass.
    expect(passes[0]?.visibleChildren).toBe(1);
  });

  it('paints one pass per inset and forces every subject but the settler as another inset ref', () => {
    const { passes, layer, terrain } = harness();
    const frames: PortraitInsetFrame[] = [
      { rect: BOX, entityRef: SETTLER, kind: 'settler', aboard: CART },
      { rect: { ...BOX, x: 300 }, entityRef: HOUSE, kind: 'building' },
    ];
    layer.set(frames);
    layer.draw(CAMERA, terrain);
    expect(passes.map((pass) => pass.frame.x)).toEqual([BOX.x, 300]);
    expect(layer.subjects().others).toEqual([CART, HOUSE]);
    layer.set([]);
    layer.draw(CAMERA, terrain);
    expect(passes).toHaveLength(2);
  });
});
