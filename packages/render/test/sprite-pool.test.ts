import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ElevationField } from '../src/data/elevation.js';
import { type Camera, ONE, tileToScreen } from '../src/data/iso.js';
import type { Viewport } from '../src/data/viewport.js';
import { type PoolFrame, SpritePool } from '../src/gpu/sprite-pool/index.js';
import { SNAP_DISTANCE } from '../src/gpu/sprite-pool/motion.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

/**
 * The retained pool's SCREEN-bounded reconcile: per-frame work must track what's on screen, not the whole
 * pool (the render contract). The detach and paletted-placement passes iterate the {@link SpritePool}
 * `attached` set — the entities on the layer — so the attached-layer child count IS that scan domain,
 * while `stats().pooled` is the whole pool.
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

  it('detaches a dead entity immediately, defers its reap, and keeps a culled-but-live one', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile(poolFrame(snapshotOf(BUILDINGS), FRAMES_ALL)); // frame 1
    expect(layer.children.length).toBe(3);
    expect(pool.stats().pooled).toBe(3);

    // Building 2 leaves the snapshot (died) while still framed. The next frame is not a reap frame, so it
    // detaches at once (invisible) but its display object is not yet freed — the deferred-reap contract.
    const survivors = snapshotOf([nth(BUILDINGS, 0), nth(BUILDINGS, 2)]);
    pool.reconcile(poolFrame(survivors, FRAMES_ALL)); // frame 2 — not a reap multiple
    expect(layer.children.length).toBe(2); // detached the same frame it died
    expect(pool.stats().pooled).toBe(3); // still pooled — reap runs on an interval, not every frame

    // Now frame only building 1 (building 3 stays live but culled). Drive frames until the reap fires.
    for (let i = 0; i < 64 && pool.stats().pooled > 2; i++) {
      pool.reconcile(poolFrame(survivors, FRAMES_FIRST));
    }
    expect(pool.stats().pooled).toBe(2); // the dead entity is freed; the culled-but-live one is kept
    expect(layer.children.length).toBe(1); // only building 1 is framed
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

/** A drawable settler at a tile — `Settler` + `Position` is all the scene collector needs. */
function settler(id: number, col: number, row: number, extra: Record<string, unknown> = {}): EntitySnapshot {
  return { id, components: { Settler: { tribe: 0 }, Position: { x: col * ONE, y: row * ONE }, ...extra } };
}

/**
 * The motion track across a gap in the draw list. A pooled entity keeps its track while it is not drawn
 * (indoors, fogged, culled), so resuming the lerp from that stale anchor would glide it in from wherever it
 * vanished — `trackMotion`'s own SNAP_DISTANCE only catches gaps wider than 128 px. The pool must reset the
 * track at re-entry instead, without disturbing the interpolation of anything drawn continuously.
 */
describe('SpritePool — motion track across a gap in the draw list', () => {
  /** The anchor a ref was drawn at this frame, failing the test if it was not drawn at all. */
  function anchorAt(pool: SpritePool, ref: number): { x: number; y: number } {
    const anchor = pool.anchorOf(ref);
    if (anchor === undefined) throw new Error(`entity ${ref} was not drawn this frame`);
    return anchor;
  }

  it('snaps a settler re-entering the draw set instead of gliding from its stale anchor', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const inside = { Resting: { at: 99 } }; // the workplace marker — live and pooled, but not drawn

    // Frame 1: at its workplace door, first sighting — snaps, so this IS the door anchor.
    pool.reconcile({ ...poolFrame(snapshotOf([settler(1, 0, 0)]), FRAMES_ALL), tick: 0 });
    const door = anchorAt(pool, 1);

    // Frames 2-4: inside, working. Not drawn, but pooled — the track goes stale where it stood.
    for (let tick = 1; tick <= 3; tick++) {
      pool.reconcile({ ...poolFrame(snapshotOf([settler(1, 0, 0, inside)]), FRAMES_ALL), tick });
      expect(pool.anchorOf(1)).toBeUndefined();
    }
    expect(pool.stats().pooled).toBe(1); // kept across the gap (a re-mint would snap for the wrong reason)

    // Frame 5: back out, one tile on — near enough that SNAP_DISTANCE cannot be what saves it. Settler 2 is
    // the oracle: first sighted here this frame, so it snaps, and its anchor IS this tile's anchor.
    pool.reconcile({
      ...poolFrame(snapshotOf([settler(1, 0, 1), settler(2, 0, 1)]), FRAMES_ALL),
      tick: 4,
      alpha: 0.5, // mid-tick: a track resumed from the door would draw halfway back toward it
    });
    const emerged = anchorAt(pool, 1);
    // Guards the setup, not the fix: were this gap ever to exceed SNAP_DISTANCE, trackMotion would snap on
    // its own and the assertion below would pass without a re-entry reset at all. Per-axis, like trackMotion.
    expect(Math.max(Math.abs(emerged.x - door.x), Math.abs(emerged.y - door.y))).toBeLessThan(SNAP_DISTANCE);
    expect(emerged).not.toEqual(door); // it did move — the assertion below is not vacuous
    expect(emerged).toEqual(anchorAt(pool, 2)); // drawn where a freshly-sighted settler on this tile draws
  });

  it('interpolates a settler drawn on consecutive frames — the reset must not fire on every frame', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);

    pool.reconcile({ ...poolFrame(snapshotOf([settler(1, 0, 0)]), FRAMES_ALL), tick: 0 });
    const from = anchorAt(pool, 1);

    // Drawn again the very next frame, one tile on. Settler 2 is first sighted here, so it snaps and marks
    // the destination anchor.
    pool.reconcile({
      ...poolFrame(snapshotOf([settler(1, 0, 1), settler(2, 0, 1)]), FRAMES_ALL),
      tick: 1,
      alpha: 0.5,
    });
    const to = anchorAt(pool, 2);
    // Half a tick behind the sim, as the fixed-timestep contract wants — NOT snapped onto `to`. Pins the
    // other half of the predicate: were the `lastSeen` stamp ever hoisted above the reset, every entity
    // would read as re-entering, snap every frame, and inter-tick interpolation would silently die.
    expect(anchorAt(pool, 1)).toEqual({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  });
});

describe('SpritePool — details-panel portrait subject visibility', () => {
  it('force-draws an off-screen subject but hides it on the main map; show/hide toggles it', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const onScreen = building(1, 0, 0);
    const subject = settler(2, 0, 20); // far off-screen relative to FRAMES_FIRST

    pool.reconcile({ ...poolFrame(snapshotOf([onScreen, subject]), FRAMES_FIRST), portraitRef: 2 });

    const subjectContainer = pool.portraitSubjectContainer();
    expect(subjectContainer).not.toBeNull();
    expect(layer.children.includes(subjectContainer as never)).toBe(true); // force-drawn (attached)…
    expect((subjectContainer as { visible: boolean }).visible).toBe(false); // …but hidden on the main map
    expect(pool.portraitSubjectIsIndoor()).toBe(false); // off-screen, still animates

    pool.showPortraitSubject();
    expect((subjectContainer as { visible: boolean }).visible).toBe(true); // revealed for the cutout render
    pool.hidePortraitSubject();
    expect((subjectContainer as { visible: boolean }).visible).toBe(false); // hidden again for the main stage
  });

  it('un-hides the subject when the portrait closes (next reconcile restores its visibility)', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const onScreen = building(1, 0, 0);
    const subject = settler(2, 0, 20);

    pool.reconcile({ ...poolFrame(snapshotOf([onScreen, subject]), FRAMES_FIRST), portraitRef: 2 });
    const subjectContainer = pool.portraitSubjectContainer() as { visible: boolean };
    expect(subjectContainer.visible).toBe(false);

    // Portrait closes: no portraitRef. The off-screen subject is culled again, but its forced-hidden
    // visibility is restored at the top of reconcile so it never stays invisible when it scrolls back.
    pool.reconcile(poolFrame(snapshotOf([onScreen, subject]), FRAMES_FIRST));
    expect(subjectContainer.visible).toBe(true);
    expect(pool.portraitSubjectContainer()).toBeNull();
  });

  it('an indoor subject reports indoor and solos: siblings hide during the render, then restore', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), undefined);
    const workplace = building(10, 0, 0);
    const other = settler(2, 0, 0); // another on-screen unit — a sprite-layer sibling
    const subject = settler(1, 0, 0, { Resting: { at: 10 } }); // waiting inside its workplace

    pool.reconcile({ ...poolFrame(snapshotOf([workplace, other, subject]), FRAMES_ALL), portraitRef: 1 });

    expect(pool.portraitSubjectIsIndoor()).toBe(true);
    const subjectContainer = pool.portraitSubjectContainer();
    expect(subjectContainer).not.toBeNull();

    pool.showPortraitSubject();
    const beforeSolo = layer.children.map((c) => c.visible);
    pool.beginPortraitSolo();
    for (const c of layer.children) expect(c.visible).toBe(c === subjectContainer); // only the subject draws
    pool.endPortraitSolo();
    expect(layer.children.map((c) => c.visible)).toEqual(beforeSolo); // every sibling restored exactly
  });
});
