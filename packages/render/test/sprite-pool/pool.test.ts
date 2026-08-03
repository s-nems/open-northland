import type { WorldSnapshot } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type Camera, tileToScreen, type Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { SNAP_DISTANCE } from '../../src/gpu/sprite-pool/motion.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * The detach and paletted-placement passes iterate the pool's `attached` set, so the layer's child count
 * is that per-frame scan domain while `stats().pooled` is the whole pool. `sheet: undefined` draws every
 * entity as the placeholder marker, so these specs need no atlas.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };

/** `Building` + `Position` is all the scene collector needs to classify a building. */
function building(id: number, col: number, row: number): ReturnType<typeof entity> {
  return entity(id, col, row, { Building: {} });
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

// Three buildings in one column, ten rows apart, so a viewport picks a subset by screen y. The boxes are
// derived from the projected positions rather than assuming the row pitch.
const ROWS = [0, 10, 20];
const BUILDINGS = ROWS.map((row, i) => building(i + 1, 0, row));
const POS = ROWS.map((row) => tileToScreen(0, row));
const MARGIN = 50; // < half the row-group gap, so a one-row box excludes its neighbours
function nth<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`missing item ${index}`);
  return value;
}
const FRAMES_ALL: Viewport = {
  minX: Math.min(...POS.map((p) => p.x)) - MARGIN,
  maxX: Math.max(...POS.map((p) => p.x)) + MARGIN,
  minY: Math.min(...POS.map((p) => p.y)) - MARGIN,
  maxY: Math.max(...POS.map((p) => p.y)) + MARGIN,
};
const FRAMES_FIRST: Viewport = {
  minX: nth(POS, 0).x - MARGIN,
  maxX: nth(POS, 0).x + MARGIN,
  minY: nth(POS, 0).y - MARGIN,
  maxY: nth(POS, 0).y + MARGIN,
};
// Frames every entity whatever its tile, so a generated pool attaches without hand-fitting a box to it.
const FRAMES_EVERYTHING: Viewport = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };

describe('SpritePool - reconcile scans track the screen, not the pool', () => {
  it('attaches only the visible entities and keeps culled ones pooled', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    expect(layer.children.length).toBe(3);
    expect(pool.stats().pooled).toBe(3);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_FIRST));
    expect(layer.children.length).toBe(1);
    expect(pool.stats().pooled).toBe(3);
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

  it('detaches a dead entity immediately, reaps it within the budget, and keeps a culled-but-live one', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL));
    expect(layer.children.length).toBe(3);
    expect(pool.stats().pooled).toBe(3);

    // Building 2 leaves the snapshot; building 3 stays live but culled.
    const survivors = snapshotOf([nth(BUILDINGS, 0), nth(BUILDINGS, 2)]);
    pool.reconcile(poolFrame(survivors, FRAMES_FIRST));
    expect(layer.children.length).toBe(1);
    // Three entries fit inside one reap budget, so the dead entity is freed the same frame while the
    // culled-but-live building 3 is kept.
    expect(pool.stats().pooled).toBe(2);
  });

  // Kill `n` live buildings at once and drive the reap to completion, reporting how many were freed on
  // the first dead frame and how many frames the whole pool took to drain.
  function reapDrain(n: number): { firstSlice: number; framesToDrain: number } {
    const pool = new SpritePool(new Container(), new TextureCache(), undefined);
    const live = Array.from({ length: n }, (_, i) => building(i + 1, i, 0));
    pool.reconcile(poolFrame(snapshotOf(live), FRAMES_EVERYTHING));
    expect(pool.stats().pooled).toBe(n);

    const dead = snapshotOf([]);
    pool.reconcile(poolFrame(dead, FRAMES_EVERYTHING));
    const firstSlice = n - pool.stats().pooled;
    let framesToDrain = 1;
    while (pool.stats().pooled > 0) {
      if (framesToDrain > n + 2) throw new Error('reap never drained the pool'); // a stuck cursor would hang
      pool.reconcile(poolFrame(dead, FRAMES_EVERYTHING));
      framesToDrain++;
    }
    return { firstSlice, framesToDrain };
  }

  it('reaps a bounded slice per frame, so the per-frame reap is O(1), not O(pooled)', () => {
    const small = reapDrain(64);
    const large = reapDrain(256);

    // A full sweep would free 64 vs 256 here.
    expect(large.firstSlice).toBe(small.firstSlice);
    expect(small.firstSlice).toBeGreaterThan(0);
    expect(small.firstSlice).toBeLessThan(64);
    // A bigger pool trades latency, not per-frame cost: ⌈pooled / budget⌉ frames to drain.
    expect(large.framesToDrain).toBeGreaterThan(small.framesToDrain);
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

/** `Settler` + `Position` is all the scene collector needs to classify a settler. */
function settler(
  id: number,
  col: number,
  row: number,
  extra: Record<string, unknown> = {},
): ReturnType<typeof entity> {
  return entity(id, col, row, { Settler: { tribe: 0 }, ...extra });
}

function anchorAt(pool: SpritePool, ref: number): { x: number; y: number } {
  const anchor = pool.anchorOf(ref);
  if (anchor === undefined) throw new Error(`entity ${ref} was not drawn this frame`);
  return anchor;
}

/**
 * A pooled entity keeps its motion track while it is not drawn (indoors, fogged, culled), and
 * `trackMotion`'s own SNAP_DISTANCE only catches gaps wider than 128 px, so the pool must reset the track
 * at re-entry without disturbing anything drawn continuously.
 */
describe('SpritePool - motion track across a gap in the draw list', () => {
  it('snaps a settler re-entering the draw set instead of gliding from its stale anchor', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const inside = { Resting: { at: 99 } }; // the workplace marker - live and pooled, but not drawn

    // A first sighting snaps, so this is the door anchor.
    pool.reconcile({ ...poolFrame(snapshotOf([settler(1, 0, 0)]), FRAMES_ALL), tick: 0 });
    const door = anchorAt(pool, 1);

    // Three frames indoors: not drawn, but pooled, so the track goes stale where it stood.
    for (let tick = 1; tick <= 3; tick++) {
      pool.reconcile({ ...poolFrame(snapshotOf([settler(1, 0, 0, inside)]), FRAMES_ALL), tick });
      expect(pool.anchorOf(1)).toBeUndefined();
    }
    expect(pool.stats().pooled).toBe(1); // a re-mint would snap for the wrong reason

    // Back out one tile on. Settler 2 is the oracle: first sighted here, so it snaps onto this tile's
    // anchor.
    pool.reconcile({
      ...poolFrame(snapshotOf([settler(1, 0, 1), settler(2, 0, 1)]), FRAMES_ALL),
      tick: 4,
      alpha: 0.5, // mid-tick: a track resumed from the door would draw halfway back toward it
    });
    const emerged = anchorAt(pool, 1);
    // Guards the setup: a gap wider than SNAP_DISTANCE would make trackMotion snap on its own and pass
    // the assertions below without any re-entry reset. Per-axis, like trackMotion.
    expect(Math.max(Math.abs(emerged.x - door.x), Math.abs(emerged.y - door.y))).toBeLessThan(SNAP_DISTANCE);
    expect(emerged).not.toEqual(door); // it did move - the assertion below is not vacuous
    expect(emerged).toEqual(anchorAt(pool, 2));
  });

  it('interpolates a settler drawn on consecutive frames - the reset must not fire on every frame', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile({ ...poolFrame(snapshotOf([settler(1, 0, 0)]), FRAMES_ALL), tick: 0 });
    const from = anchorAt(pool, 1);

    // Drawn again the next frame, one tile on. Settler 2 is first sighted here, so it marks the
    // destination anchor.
    pool.reconcile({
      ...poolFrame(snapshotOf([settler(1, 0, 1), settler(2, 0, 1)]), FRAMES_ALL),
      tick: 1,
      alpha: 0.5,
    });
    const to = anchorAt(pool, 2);
    // Hoisting the `lastSeen` stamp above the reset would make every entity read as re-entering, snap
    // every frame, and kill inter-tick interpolation silently.
    expect(anchorAt(pool, 1)).toEqual({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  });
});

/**
 * Every kind shares one `updatePooled` path, so only the pool proves a projectile's track is born under
 * the projectile band; `motion.test.ts` owns what the bands themselves do.
 */
describe('SpritePool - a projectile glides where a walker snaps', () => {
  /** `Projectile` + `Position` is all the scene collector needs to classify a projectile. */
  function projectile(id: number, col: number, row: number): ReturnType<typeof entity> {
    return entity(id, col, row, { Projectile: {} });
  }

  const CATCH_UP_TICKS = 3;
  const TILES_FLOWN = 3; // a tile a tick, the pace of a bow shot

  it('interpolates a catch-up frame the walker policy snaps', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    // Settler 3 makes the identical jump - the walker-policy oracle.
    pool.reconcile({
      ...poolFrame(snapshotOf([projectile(1, 0, 0), settler(3, 0, 0)]), FRAMES_EVERYTHING),
      tick: 0,
    });
    const from = anchorAt(pool, 1);

    // Several ticks land in this one frame - the catch-up case the policy exists for. Projectile 2 is
    // first sighted at the destination, so its anchor marks where the travel ends.
    pool.reconcile({
      ...poolFrame(
        snapshotOf([
          projectile(1, TILES_FLOWN, 0),
          projectile(2, TILES_FLOWN, 0),
          settler(3, TILES_FLOWN, 0),
        ]),
        FRAMES_EVERYTHING,
      ),
      tick: CATCH_UP_TICKS,
      alpha: 0.5,
    });
    const to = anchorAt(pool, 2);
    expect(Math.abs(to.x - from.x)).toBeGreaterThan(SNAP_DISTANCE); // travel the walker band rejects
    expect(anchorAt(pool, 3)).toEqual(to);
    expect(anchorAt(pool, 1)).toEqual({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  });
});

describe('SpritePool - details-panel portrait subject visibility', () => {
  // Any camera framings do: these specs are about visibility pairing, not placement.
  const INSET = { camera: CAMERA, width: 64, height: 64 };
  const MAIN = { camera: CAMERA, width: 800, height: 600 };

  function hiddenSubject(layer: Container): Container {
    const hidden = layer.children.filter((c) => !c.visible);
    expect(hidden).toHaveLength(1);
    const subject = hidden[0];
    if (subject === undefined) throw new Error('no force-hidden subject on the layer');
    return subject;
  }

  it('force-draws an off-screen subject hidden on the main map; the pass reveals it only for its render', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const onScreen = building(1, 0, 0);
    const subject = settler(2, 0, 20); // far off-screen relative to FRAMES_FIRST

    pool.reconcile({ ...poolFrame(snapshotOf([onScreen, subject]), FRAMES_FIRST), portraitRef: 2 });

    const subjectContainer = hiddenSubject(layer);
    pool.portraitPass(INSET, MAIN, (soloKeep) => {
      expect(soloKeep).toBeNull(); // off-screen but not indoor, so it renders with the world around it
      expect(subjectContainer.visible).toBe(true);
    });
    expect(subjectContainer.visible).toBe(false);
  });

  it('un-hides the subject when the portrait closes (next reconcile restores its visibility)', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const onScreen = building(1, 0, 0);
    const subject = settler(2, 0, 20);

    pool.reconcile({ ...poolFrame(snapshotOf([onScreen, subject]), FRAMES_FIRST), portraitRef: 2 });
    const subjectContainer = hiddenSubject(layer);

    // Without a portraitRef the subject is culled again, but reconcile restores the forced-hidden
    // visibility first, so it never stays invisible when it scrolls back.
    pool.reconcile(poolFrame(snapshotOf([onScreen, subject]), FRAMES_FIRST));
    expect(subjectContainer.visible).toBe(true);
    expect(layer.children.every((c) => c.visible)).toBe(true);
  });

  it('solos an indoor subject: siblings hide during its render only, then restore exactly', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const workplace = building(10, 0, 0);
    const other = settler(2, 0, 0);
    const subject = settler(1, 0, 0, { Resting: { at: 10 } }); // waiting inside its workplace

    pool.reconcile({ ...poolFrame(snapshotOf([workplace, other, subject]), FRAMES_ALL), portraitRef: 1 });
    const subjectContainer = hiddenSubject(layer);

    const before = layer.children.map((c) => c.visible);
    pool.portraitPass(INSET, MAIN, (soloKeep) => {
      expect(soloKeep).toBe(layer); // indoor: keep the sprite layer, blank the rest of the world
      for (const c of layer.children) expect(c.visible).toBe(c === subjectContainer);
    });
    expect(layer.children.map((c) => c.visible)).toEqual(before);
  });

  it('restores the borrow when the render throws - no unit stays hidden, no sibling stays blanked', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const workplace = building(10, 0, 0);
    const other = settler(2, 0, 0);
    const subject = settler(1, 0, 0, { Resting: { at: 10 } });

    pool.reconcile({ ...poolFrame(snapshotOf([workplace, other, subject]), FRAMES_ALL), portraitRef: 1 });
    const before = layer.children.map((c) => c.visible);

    expect(() =>
      pool.portraitPass(INSET, MAIN, () => {
        throw new Error('render died');
      }),
    ).toThrow('render died');
    expect(layer.children.map((c) => c.visible)).toEqual(before);
  });
});
