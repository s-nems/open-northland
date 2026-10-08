import { type Application, Container, type Rectangle } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../src/data/projection/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import { type PortraitInsetFrame, PortraitInsetLayer } from '../src/gpu/overlays/portrait-inset.js';
import { SpritePool } from '../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * The portrait insets: each frame paints its own cutout after the main render, a rider stands alone on
 * the vehicle's spot, and a box with nothing to frame still gets its floor so the map never shows
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
const SHIP = 4;

interface Pass {
  readonly frame: Rectangle;
  readonly x: number;
  readonly visibleChildren: number;
  readonly visibleSprites: number;
}

function harness(portraitRef?: number) {
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
          visibleSprites: sprites.children.filter((c) => c.visible).length,
        }),
    },
  } as unknown as Application;
  const pool = new SpritePool(sprites, new TextureCache(), undefined);
  // The rider has no Position: it draws only as the portrait's subject.
  const rider = { id: SETTLER, components: { Settler: { tribe: 0 }, Rider: { vehicle: CART } } };
  pool.reconcile({
    snapshot: snapshotOf([rider, entity(CART, 4, 4, { Vehicle: {} }), entity(HOUSE, 8, 4, { Building: {} })]),
    ...(portraitRef === undefined ? {} : { portraitRef }),
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
  it("draws a rider alone on its vehicle's spot, over the panel's backdrop", () => {
    const { pool, passes, layer, terrain } = harness(SETTLER);
    const cart = pool.anchorOf(CART);
    if (cart === undefined) throw new Error('expected the cart drawn');
    expect(pool.anchorOf(SETTLER)).toEqual(cart);
    layer.set([{ rect: BOX, entityRef: SETTLER, kind: 'settler' }]);
    layer.draw(CAMERA, terrain);
    expect(passes).toHaveLength(1);
    const scale = BOX.h / 58;
    expect(passes[0]?.x).toBeCloseTo(BOX.w / 2 - cart.x * scale);
    // The sprite layer alone, holding the rider alone: neither the cart nor the ground it crosses.
    expect(passes[0]?.visibleChildren).toBe(1);
    expect(passes[0]?.visibleSprites).toBe(1);
  });

  it("holds a vehicle's zoom while its drawn box shrinks between frames, and forgets it once unframed", () => {
    // A stand-in pool: the vehicle's box narrows as a turning ship or a walking driver changes frame.
    const anchor = { x: 100, y: 200 };
    let box = { minX: 60, minY: 150, maxX: 140, maxY: 210 };
    const scales: number[] = [];
    const pool = {
      boundsOf: () => box,
      anchorOf: () => anchor,
      portraitPass: (_subjects: readonly number[], inset: { camera: Camera }) => {
        scales.push(inset.camera.scale ?? 0);
      },
    } as unknown as SpritePool;
    const layer = new PortraitInsetLayer(
      { screen: { width: 800, height: 600 } } as Application,
      new Container(),
      pool,
    );
    const frames: PortraitInsetFrame[] = [{ rect: BOX, entityRef: CART, kind: 'vehicle' }];
    layer.set(frames);
    layer.draw(CAMERA);
    box = { minX: 90, minY: 150, maxX: 110, maxY: 210 };
    layer.draw(CAMERA);
    expect(scales[1]).toBe(scales[0]);
    // Unframed for a frame, the vehicle starts afresh and fits its narrower box closer.
    layer.set([]);
    layer.set(frames);
    layer.draw(CAMERA);
    expect(scales[2]).toBeGreaterThan(scales[0] ?? 0);
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
    const { passes, layer, terrain } = harness(SETTLER);
    const frames: PortraitInsetFrame[] = [
      { rect: BOX, entityRef: SETTLER, kind: 'settler' },
      { rect: { ...BOX, x: 300 }, entityRef: HOUSE, kind: 'building' },
      { rect: { ...BOX, x: 500 }, entityRef: CART, kind: 'vehicle', aboard: SHIP },
    ];
    layer.set(frames);
    layer.draw(CAMERA, terrain);
    expect(passes.map((pass) => pass.frame.x)).toEqual([BOX.x, 300, 500]);
    expect(layer.subjects()).toEqual({ ref: SETTLER, house: null, others: [HOUSE, CART, SHIP] });
    layer.set([]);
    layer.draw(CAMERA, terrain);
    expect(passes).toHaveLength(3);
  });
});
