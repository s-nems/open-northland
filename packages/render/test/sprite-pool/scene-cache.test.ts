import type { WorldSnapshot } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * The scene build is a pure function of the frame inputs the pool keys on, so `drawnItems()` identity
 * is the observable: a reused array proves the build was skipped, a fresh one proves it ran.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const BOX: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

function frameFor(snapshot: WorldSnapshot, extra: Partial<PoolFrame> = {}): PoolFrame {
  return {
    snapshot,
    viewport: BOX,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    ...extra,
  };
}

const WORLD = snapshotOf([entity(1, 0, 0, { Building: {} }), entity(2, 3, 0, { Settler: { tribe: 0 } })]);

describe('SpritePool - scene build reuse across identical frames', () => {
  it('reuses the build while inputs hold, and rebuilds when the snapshot or viewport moves', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), undefined);

    pool.reconcile(frameFor(WORLD));
    const built = pool.drawnItems();
    expect(built.length).toBe(2);

    // Same snapshot object, an equal-valued fresh viewport, a moved alpha: only interpolation work.
    pool.reconcile(frameFor(WORLD, { viewport: { ...BOX }, alpha: 0.5 }));
    expect(pool.drawnItems()).toBe(built);

    pool.reconcile(frameFor(snapshotOf([entity(1, 0, 0, { Building: {} })])));
    const afterSnapshot = pool.drawnItems();
    expect(afterSnapshot).not.toBe(built);

    pool.reconcile(frameFor(WORLD, { viewport: { ...BOX, maxX: 500 } }));
    expect(pool.drawnItems()).not.toBe(afterSnapshot);
  });

  it('keys the fog cull on the epoch, and never caches a fog cull that carries no epoch', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), undefined);
    const seeAll = () => true;

    pool.reconcile(frameFor(WORLD, { fogVisible: seeAll, fogEpoch: 1 }));
    const built = pool.drawnItems();
    pool.reconcile(frameFor(WORLD, { fogVisible: seeAll, fogEpoch: 1 }));
    expect(pool.drawnItems()).toBe(built);

    pool.reconcile(frameFor(WORLD, { fogVisible: seeAll, fogEpoch: 2 }));
    const rebuilt = pool.drawnItems();
    expect(rebuilt).not.toBe(built);

    // No epoch means no change signal: every such frame must rebuild.
    pool.reconcile(frameFor(WORLD, { fogVisible: seeAll }));
    const unkeyed = pool.drawnItems();
    expect(unkeyed).not.toBe(rebuilt);
    pool.reconcile(frameFor(WORLD, { fogVisible: seeAll }));
    expect(pool.drawnItems()).not.toBe(unkeyed);
  });

  it('trips on an in-place deletion from the live staticRefs set', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), undefined);
    const staticRefs = new Set([1]);

    pool.reconcile(frameFor(WORLD, { staticRefs }));
    const built = pool.drawnItems();
    expect(built.length).toBe(1); // the building is drawn by the static layer

    staticRefs.delete(1); // the first-worked handover mutates the set it already passed
    pool.reconcile(frameFor(WORLD, { staticRefs }));
    expect(pool.drawnItems().length).toBe(2);
  });

  it('rebuilds when the portrait subject changes, so the force-draw flag is never stale', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), undefined);

    pool.reconcile(frameFor(WORLD));
    const built = pool.drawnItems();
    pool.reconcile(frameFor(WORLD, { portraitRef: 2 }));
    expect(pool.drawnItems()).not.toBe(built);
  });
});
