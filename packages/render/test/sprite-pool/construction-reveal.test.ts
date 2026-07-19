import type { TextureSource } from 'pixi.js';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * The construction reveal's stage set and its per-pixel reveal must ride ONE eased progress value. The pool
 * eases a displayed reveal toward the sim's `built` between the sparse per-swing steps; if it selects which
 * stages draw from the raw sim `built` while revealing their pixels from the lagging eased value, a fast
 * build (x3 speed, a big crew hammering many swings a tick) clears a scaffold stage's `toPct` and drops it
 * a frame before the covering body stage's eased reveal has risen over it — the upper part of the building
 * blinks out and grows back. This drives the real pool across a large one-frame `built` jump and asserts the
 * scaffold stage stays drawn (it is the fixture's fake TextureSource, so no GPU is needed).
 */

const SIM_ONE = 65536; // the sim's fixed-point ONE — `built` is a 0..ONE fraction (fx.ts)
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const source = {} as TextureSource;

/** An atlas frame at bob `n` (the fake source is never sampled — binding a frame is the pool's decision). */
const frame = (
  n: number,
): [number, { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number }] => [
  n,
  { x: n, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 },
];

// A house-family sheet with a time sheet (per-pixel reveal path): a scaffold stage (bob 85) covering the
// lower window and the finished body (bob 70) revealing across [20,100] — the overlapping-window shape the
// real viking houses use, where the scaffold hands off to the body partway up.
const atlas: SpriteAtlas = { width: 100, height: 10, frames: new Map([frame(70), frame(85), frame(90)]) };
const times = { width: 100, height: 10, values: new Uint8Array(100 * 10) };
const SCAFFOLD_TO_PCT = 60;
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: {
      byType: { 13: { layer: 'houses', bob: 70 } },
      default: 70,
      constructionByType: {
        13: [
          { layer: 'houses', bob: 85, fromPct: 0, toPct: SCAFFOLD_TO_PCT },
          { layer: 'houses', bob: 70, fromPct: 20, toPct: 100 },
        ],
      },
      // The next tier's finished body (bob 90) revealing over the kept old-tier body across the whole
      // upgrade — the one-or-two full-window rows the real data binds per chained tier.
      upgradeByType: { 13: [{ layer: 'houses', bob: 90, fromPct: 0, toPct: 100 }] },
    },
  },
  families: { houses: { source, atlas, times } },
};

const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
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
/** A type-13 construction site at `pct` percent built. */
function site(pct: number): ReturnType<typeof entity> {
  return entity(1, 0, 0, {
    Building: { buildingType: 13, built: Math.round((pct * SIM_ONE) / 100) },
    UnderConstruction: {},
  });
}
/** A type-13 UPGRADE site at `pct` percent rebuilt — the old-tier body plus the revealing next-tier overlay. */
function upgradeSite(pct: number): ReturnType<typeof entity> {
  return entity(1, 0, 0, {
    Building: { buildingType: 13, built: Math.round((pct * SIM_ONE) / 100) },
    UnderConstruction: {},
    Upgrading: {},
  });
}
/** How many of the drawn entity's stage sprites are visible this frame. */
function visibleStages(layer: Container): number {
  const container = layer.children[0] as Container | undefined;
  if (container === undefined) return 0;
  return (container.children as { visible: boolean }[]).filter((s) => s.visible).length;
}

describe('SpritePool — construction stages track the eased reveal, not the raw sim built', () => {
  it('keeps the scaffold stage drawn when built jumps past its window in one frame', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    // First sight mid-scaffold: the reveal initialises straight to 55%, so both stages draw.
    pool.reconcile(poolFrame(snapshotOf([site(55)])));
    expect(visibleStages(layer)).toBe(2);

    // A big one-frame jump to 75% — past the scaffold's 60% toPct. The eased displayed reveal still lags
    // near 56%, so the scaffold must stay drawn (selecting stages off the raw 75% would drop it here, the
    // one-frame gap the fix removes). It only retires once the eased reveal actually passes its window.
    pool.reconcile(poolFrame(snapshotOf([site(75)])));
    expect(visibleStages(layer)).toBe(2);
  });

  it('keeps the scaffold under the revealing body past its own window, and it comes down at completion', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile(poolFrame(snapshotOf([site(55)])));

    // Hold the sim past the scaffold's 60% window and let the eased reveal climb. The scaffold (bob 85)
    // stays drawn under the body (bob 70) that covers it as it reveals — the body is stacked above it and
    // its window runs to 100 — so the roof grows on the scaffold instead of the scaffold blinking out.
    for (let f = 0; f < 60; f++) pool.reconcile(poolFrame(snapshotOf([site(75)])));
    expect(visibleStages(layer)).toBe(2);

    // Completion (no UnderConstruction, built >= ONE) snaps to the finished body — the scaffold comes down,
    // leaving one sprite drawn.
    const done = entity(1, 0, 0, { Building: { buildingType: 13, built: SIM_ONE } });
    pool.reconcile(poolFrame(snapshotOf([done])));
    expect(visibleStages(layer)).toBe(1);
  });
});

describe('SpritePool — an upgrade site reveals the next tier from its upgradePct, not full-frame', () => {
  it('hides the next-tier overlay at 0% (the fake source is not bakeable, so the crop fallback decides)', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    // Upgrade just started: progress rides `upgradePct` (builtPct is deliberately undefined for an
    // Upgrading building). The eased reveal must pick it up — without that the overlay draws its full
    // frame and the next tier pops in instantly (the regression this test pins).
    pool.reconcile(poolFrame(snapshotOf([upgradeSite(0)])));
    expect(visibleStages(layer)).toBe(1); // the kept old-tier body alone

    // Let the eased reveal climb toward a nearly-done upgrade — the overlay's cropped rise appears.
    for (let f = 0; f < 60; f++) pool.reconcile(poolFrame(snapshotOf([upgradeSite(90)])));
    expect(visibleStages(layer)).toBe(2); // old body + the risen next-tier overlay
  });
});
