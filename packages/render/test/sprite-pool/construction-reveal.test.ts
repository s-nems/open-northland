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
 * The stage set and the per-pixel reveal must ride one eased progress value. Selecting which stages draw
 * from the raw sim `built` while revealing their pixels from the lagging eased value drops a scaffold
 * stage a frame before the covering body has risen over it, so the upper building blinks out and grows
 * back on a fast build.
 */

const SIM_ONE = 65536; // the sim's fixed-point ONE - `built` is a 0..ONE fraction (fx.ts)
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const source = {} as TextureSource;

/** An atlas frame at bob `n`; the fake source is never sampled. */
const frame = (
  n: number,
): [number, { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number }] => [
  n,
  { x: n, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 },
];

// A scaffold stage (bob 85) over the lower window and a finished body (bob 70) revealing across [20,100]:
// the overlapping-window shape the real viking houses use, where the scaffold hands off partway up.
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
      // One full-window row per chained tier, as the real data binds it.
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
function site(pct: number): ReturnType<typeof entity> {
  return entity(1, 0, 0, {
    Building: { buildingType: 13, built: Math.round((pct * SIM_ONE) / 100) },
    UnderConstruction: {},
  });
}
/** A site rebuilding to the next tier: the kept old-tier body plus the revealing next-tier overlay. */
function upgradeSite(pct: number): ReturnType<typeof entity> {
  return entity(1, 0, 0, {
    Building: { buildingType: 13, built: Math.round((pct * SIM_ONE) / 100) },
    UnderConstruction: {},
    Upgrading: {},
  });
}
function visibleStages(layer: Container): number {
  const container = layer.children[0] as Container | undefined;
  if (container === undefined) return 0;
  return (container.children as { visible: boolean }[]).filter((s) => s.visible).length;
}

describe('SpritePool - construction stages track the eased reveal, not the raw sim built', () => {
  it('keeps the scaffold stage drawn when built jumps past its window in one frame', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    // A first sighting initialises the reveal straight to 55%, so both stages draw.
    pool.reconcile(poolFrame(snapshotOf([site(55)])));
    expect(visibleStages(layer)).toBe(2);

    // A one-frame jump past the scaffold's 60% toPct, while the eased reveal still lags near 56%.
    pool.reconcile(poolFrame(snapshotOf([site(75)])));
    expect(visibleStages(layer)).toBe(2);
  });

  it('keeps the scaffold under the revealing body past its own window, and it comes down at completion', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile(poolFrame(snapshotOf([site(55)])));

    // Held past the scaffold's 60% window: the body (bob 70) is stacked above it and its window runs to
    // 100, so the roof grows over the scaffold instead of the scaffold blinking out.
    for (let f = 0; f < 60; f++) pool.reconcile(poolFrame(snapshotOf([site(75)])));
    expect(visibleStages(layer)).toBe(2);

    // Completion (no UnderConstruction, built >= ONE) snaps to the finished body.
    const done = entity(1, 0, 0, { Building: { buildingType: 13, built: SIM_ONE } });
    pool.reconcile(poolFrame(snapshotOf([done])));
    expect(visibleStages(layer)).toBe(1);
  });
});

describe('SpritePool - a rising site is picked over the finished building’s whole box', () => {
  it('stamps the same bounds at 0% as when nearly complete', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    // Nothing revealed yet, so the crop hides the sprite's full height, but the site must still be
    // clickable over the plot it will occupy.
    pool.reconcile(poolFrame(snapshotOf([site(0)])));
    const stamped = pool.boundsOf(1);
    if (stamped === undefined) throw new Error('a drawn site must stamp bounds');
    const atStart = { ...stamped }; // copied: the pool restamps this box in place each frame
    expect(atStart.maxY - atStart.minY).toBeGreaterThan(0);

    // Bounds come from each layer's uncropped frame rect. Stamping the cropped rect instead would collapse
    // the box at 0% and swell it as the building rose, making a fresh foundation unclickable.
    for (let f = 0; f < 60; f++) pool.reconcile(poolFrame(snapshotOf([site(90)])));
    expect({ ...pool.boundsOf(1) }).toEqual(atStart);
  });
});

describe('SpritePool - an upgrade site reveals the next tier from its upgradePct, not full-frame', () => {
  it('hides the next-tier overlay at 0% (the fake source is not bakeable, so the crop fallback decides)', () => {
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);

    // An upgrade's progress rides `upgradePct`; builtPct is undefined for an Upgrading building. Missing
    // that, the overlay draws its full frame and the next tier pops in instantly.
    pool.reconcile(poolFrame(snapshotOf([upgradeSite(0)])));
    expect(visibleStages(layer)).toBe(1); // the kept old-tier body alone

    for (let f = 0; f < 60; f++) pool.reconcile(poolFrame(snapshotOf([upgradeSite(90)])));
    expect(visibleStages(layer)).toBe(2); // old body plus the risen next-tier overlay
  });
});
