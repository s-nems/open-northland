import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../src/data/elevation.js';
import { type Camera, ONE, tileToScreen } from '../src/data/iso.js';
import type { Viewport } from '../src/data/viewport.js';
import { type PoolFrame, SpritePool } from '../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

/**
 * The retained pool's SCREEN-bounded reconcile: per-frame work must track what's on screen, not the pool,
 * which only shrinks on death and so grows to every entity ever seen (the render contract). The detach and
 * paletted-placement passes iterate the {@link SpritePool} `attached` set — the entities on the layer — so
 * the attached-layer child count IS that scan domain, and `stats().pooled` is the whole pool.
 *
 * SpritePool is Pixi-coupled, but its display objects construct headlessly (the map-object-removal +
 * chunk-batcher tests rely on the same), so the attach/detach/reap bookkeeping is checkable without a GL
 * context. `sheet: undefined` makes every entity draw the placeholder marker, so no atlas is needed.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };

/** A minimal drawable building at a tile — `Building` + `Position` is all the scene collector classifies. */
function building(id: number, col: number, row: number): EntitySnapshot {
  return { id, components: { Building: {}, Position: { x: col * ONE, y: row * ONE } } };
}

function snapshotOf(entities: readonly EntitySnapshot[]): WorldSnapshot {
  return { tick: 0, entities, events: [] };
}

function poolFrame(snapshot: WorldSnapshot, viewport: Viewport): PoolFrame {
  return {
    snapshot,
    viewport,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
  };
}

// Three buildings in one column, ten rows apart, so a viewport picks a subset by screen y (same column →
// same screen x under the staggered raster, distinct y per row group). Viewports are derived from the
// actual projected positions so the box math doesn't assume the row pitch.
const ROWS = [0, 10, 20];
const BUILDINGS = ROWS.map((row, i) => building(i + 1, 0, row));
const POS = ROWS.map((row) => tileToScreen(0, row));
const MARGIN = 50; // < half the row-group gap, so a one-row box excludes its neighbours
const FRAMES_ALL: Viewport = {
  minX: Math.min(...POS.map((p) => p.x)) - MARGIN,
  maxX: Math.max(...POS.map((p) => p.x)) + MARGIN,
  minY: Math.min(...POS.map((p) => p.y)) - MARGIN,
  maxY: Math.max(...POS.map((p) => p.y)) + MARGIN,
};
const FRAMES_FIRST: Viewport = {
  minX: POS[0].x - MARGIN,
  maxX: POS[0].x + MARGIN,
  minY: POS[0].y - MARGIN,
  maxY: POS[0].y + MARGIN,
};

describe('SpritePool — reconcile scans track the screen, not the pool', () => {
  it('attaches only the visible entities and keeps culled ones pooled', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    expect(layer.children.length).toBe(3); // all three framed → all attached
    expect(pool.stats().pooled).toBe(3);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_FIRST));
    expect(layer.children.length).toBe(1); // the detach pass leaves only the visible one on the layer
    expect(pool.stats().pooled).toBe(3); // the two culled entities stay pooled — they scroll back
  });

  it('re-attaches a culled entity when it scrolls back into view (never re-mints it)', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_FIRST));
    expect(layer.children.length).toBe(1);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    expect(layer.children.length).toBe(3);
    expect(pool.stats().pooled).toBe(3);
  });

  it('reaps an entity that left the snapshot but keeps a merely-culled live one', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    expect(pool.stats().pooled).toBe(3);

    // Building 2 leaves the snapshot (died); building 3 stays live but off-screen under FRAMES_FIRST.
    const survivors = snapshotOf([BUILDINGS[0], BUILDINGS[2]]);
    // The death reap runs on an interval, so drive frames until it fires (bounded, interval-agnostic).
    for (let i = 0; i < 64 && pool.stats().pooled > 2; i++) {
      pool.reconcile(poolFrame(survivors, FRAMES_FIRST));
    }
    expect(pool.stats().pooled).toBe(2); // the dead entity's display object is freed...
    expect(layer.children.length).toBe(1); // ...building 1 stays visible; building 3 is pooled-but-culled
  });

  it('destroy() frees the pool and detaches everything', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    pool.destroy();
    expect(pool.stats().pooled).toBe(0);
    expect(layer.children.length).toBe(0);
  });
});
