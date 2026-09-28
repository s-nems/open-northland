import type { Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  CRESTS_PER_ARM,
  crestMark,
  facingHeading,
  fitHull,
  type Hull,
  LAP_MARKS,
  lapMark,
  stepSailBlend,
  WAKE_DRIFT_PX_PER_TICK,
  WASH_PUFFS,
  WATER_PLANE_SQUASH,
  type WakeMark,
  washMark,
} from '../src/data/effects/index.js';
import type { SceneGround } from '../src/data/scene/index.js';
import { makeWaterField, NO_WATER, waterSurfaceAt } from '../src/data/terrain/index.js';
import { ShipWakeLayer } from '../src/gpu/overlays/ship-wake-layer.js';
import { buildAlphaMask } from '../src/gpu/sprite-pool/alpha-mask.js';
import type { DrawnGeometry, ShipAfloat } from '../src/gpu/sprite-pool/index.js';
import { keelLine } from '../src/gpu/sprite-pool/keel-line.js';

const FACING_E = 4;
const FACING_W = 1;
const FACING_NE = 3;
const FACING_N = 7;
const SEED = 17;

const hullOf = (keel: readonly number[] | undefined, facing = FACING_E): Hull =>
  fitHull(keel, facingHeading(facing), { bow: 0, stern: 0, beam: 0, centreline: 0 });
const scratch = (): WakeMark => ({ x: 0, y: 0, rx: 0, ry: 0, rotation: 0, alpha: 0 });

/** A side-on hull's keel line, left to right: a stem-post tip 60 px above the stern, then the waterline
 *  from the stern at -100 to the bow at +100, 30 screen px below the anchor amidships. */
const SIDE_KEEL = [-110, -60, -100, 0, -75, 20, -50, 30, 0, 30, 50, 30, 75, 20, 100, 0];
const COLUMN_PX = 8;

/** The keel line a waterline ellipse draws along `heading`, its centre `centreline` to starboard of the
 *  anchor: the lowest point of a one-px column every {@link COLUMN_PX}. */
function ellipseKeel(heading: number, half: number, beam: number, centreline = 0): number[] {
  const lowest = new Map<number, number>();
  const steps = 20_000;
  for (let step = 0; step < steps; step++) {
    const t = (step / steps) * 2 * Math.PI;
    const along = half * Math.cos(t);
    const lateral = centreline + beam * Math.sin(t);
    const x = along * Math.cos(heading) - lateral * Math.sin(heading);
    const y = (along * Math.sin(heading) + lateral * Math.cos(heading)) * WATER_PLANE_SQUASH;
    const column = Math.round(x);
    if (column % COLUMN_PX === 0) lowest.set(column, Math.max(lowest.get(column) ?? -Infinity, y));
  }
  return [...lowest].sort(([a], [b]) => a - b).flat();
}

describe('fitHull', () => {
  it('spans a side-on hull bow to stern and lays its near side along the keel line', () => {
    const hull = hullOf(SIDE_KEEL);
    expect(hull.bow).toBeCloseTo(100);
    expect(hull.stern).toBeCloseTo(-100);
    // 30 screen px below the anchor is 30 / squash on the water plane; the post tip does not widen it.
    expect(hull.centreline + hull.beam).toBeCloseTo(30 / WATER_PLANE_SQUASH);
    // The far side, which the keel line cannot show, lies behind the hull rather than above its deck.
    expect(hull.centreline - hull.beam).toBeGreaterThan(-30 / WATER_PLANE_SQUASH);
  });

  it('follows a hull the sprite draws below its anchor', () => {
    const lowered = SIDE_KEEL.map((v, i) => (i % 2 === 1 ? v + 20 : v));
    const hull = hullOf(lowered);
    expect(hull.centreline - hullOf(SIDE_KEEL).centreline).toBeCloseTo(20 / WATER_PLANE_SQUASH);
    expect(hull.beam).toBeCloseTo(hullOf(SIDE_KEEL).beam);
  });

  it('ends a side-on hull where its stern leaves the water, not at the post rising behind it', () => {
    // A stern post rising gently out of the water past the waterline's end at -100.
    const hull = hullOf([-160, -60, -145, -45, -130, -30, -115, -15, ...SIDE_KEEL.slice(2)]);
    expect(hull.stern).toBeCloseTo(-100);
  });

  it('ends a diagonal hull by its stem, not at the figurehead rising past it', () => {
    const keel = ellipseKeel(facingHeading(FACING_NE), 150, 40, -30);
    const tipX = (keel[keel.length - 2] ?? 0) + COLUMN_PX;
    const hull = hullOf([...keel, tipX, -120], FACING_NE);
    // Where the waterline turns steep at either end, the fit gives up a column or two of it.
    expect(hull.bow).toBeLessThanOrEqual(150);
    expect(hull.bow).toBeGreaterThan(120);
    expect(hull.stern).toBeLessThan(-120);
    // The near waterline, where the foam shows, stays on the keel line; the far side hides behind the hull.
    expect(Math.abs(hull.centreline + hull.beam - (-30 + 40))).toBeLessThan(2);
  });

  it('keeps an end-on hull its near end and beam, and gives its hidden far end a hull length', () => {
    const hull = hullOf(ellipseKeel(facingHeading(FACING_N), 150, 40), FACING_N);
    // Heading north, the stern is the near end at the bottom of the screen.
    expect(hull.stern).toBeCloseTo(-150, 0);
    expect(hull.beam).toBeGreaterThanOrEqual(40 - COLUMN_PX);
    expect(hull.beam).toBeLessThanOrEqual(40);
    expect(hull.bow - hull.stern).toBeGreaterThan(2 * hull.beam);
  });

  it('reads the same keel the other way round for a ship heading west', () => {
    const hull = hullOf(SIDE_KEEL, FACING_W);
    expect(hull.bow).toBeCloseTo(100);
    expect(hull.stern).toBeCloseTo(-100);
  });

  it('follows the hull as drawn: a diagonal lies along the 2:1 pixel-art diagonal, not the lattice step', () => {
    const SE = 5;
    const heading = facingHeading(SE);
    const screenSlope = (Math.sin(heading) * WATER_PLANE_SQUASH) / Math.cos(heading);
    expect(screenSlope).toBeCloseTo(1 / 2);
  });

  it('falls back to a symmetric default hull without a keel line', () => {
    const hull = hullOf(undefined);
    expect(hull.bow).toBeGreaterThan(0);
    expect(hull.stern).toBeCloseTo(-hull.bow);
    expect(hull.beam).toBeGreaterThan(0);
  });
});

describe('wake marks', () => {
  const hull = hullOf(SIDE_KEEL);

  it('leaves each bow crest where it fell on the water while the hull sails on', () => {
    // A crest born at time 0 slides aft at the sailing pace, so in water terms it holds still.
    const at = (time: number) => crestMark(0, 1, time, hull, 1, SEED, scratch());
    for (const time of [5, 10, 20]) {
      expect(at(time).x).toBeCloseTo(at(0).x - time * WAKE_DRIFT_PX_PER_TICK);
    }
  });

  it('opens the bow wave into a V: the arms trail either side and widen aft', () => {
    // Off the stem: a crest is born on the centre line at the very bow.
    const time = 1;
    for (let i = 0; i < CRESTS_PER_ARM; i++) {
      expect(crestMark(i, 1, time, hull, 1, SEED, scratch()).y).toBeGreaterThan(hull.centreline);
      expect(crestMark(i, -1, time, hull, 1, SEED, scratch()).y).toBeLessThan(hull.centreline);
    }
    const young = crestMark(0, 1, 30, hull, 1, SEED, scratch());
    const old = crestMark(0, 1, 60, hull, 1, SEED, scratch());
    expect(old.x).toBeLessThan(young.x);
    expect(old.y).toBeGreaterThan(young.y);
  });

  it('churns wash only aft of the stern', () => {
    for (let i = 0; i < WASH_PUFFS; i++) {
      expect(washMark(i, 13, hull, 1, SEED, scratch()).x).toBeLessThanOrEqual(hull.stern);
    }
  });

  it('keeps only the lapping foam on a ship at rest', () => {
    for (let i = 0; i < CRESTS_PER_ARM; i++)
      expect(crestMark(i, 1, 9, hull, 0, SEED, scratch()).alpha).toBe(0);
    for (let i = 0; i < WASH_PUFFS; i++) expect(washMark(i, 9, hull, 0, SEED, scratch()).alpha).toBe(0);
    for (let i = 0; i < LAP_MARKS; i++) expect(lapMark(i, 9, hull, 0, scratch()).alpha).toBeGreaterThan(0);
  });

  it('piles the foam up at the bow under way', () => {
    const bow = lapMark(0, 0, hull, 1, scratch());
    const stern = lapMark(LAP_MARKS / 2, 0, hull, 1, scratch());
    expect(bow.x).toBeGreaterThan(hull.bow);
    expect(bow.ry).toBeGreaterThan(stern.ry);
  });

  it('eases the wake in and out rather than switching it', () => {
    expect(stepSailBlend(0, true, 1)).toBeGreaterThan(0);
    expect(stepSailBlend(0, true, 1)).toBeLessThan(1);
    expect(stepSailBlend(0, true, 1000)).toBe(1);
    expect(stepSailBlend(1, false, 1000)).toBe(0);
    expect(stepSailBlend(0.5, true, -3)).toBe(0.5); // a rewound clock never jumps it
  });
});

describe('keelLine', () => {
  it('reads the bottom edge of the lowest solid texel per column, skipping empty ones', () => {
    // A 4×4 sheet: column 0 empty, column 1 solid down to row 1, columns 2-3 solid down to row 3.
    const width = 4;
    const height = 4;
    const rgba = new Uint8Array(width * height * 4);
    const solid = (x: number, y: number) => {
      rgba[(y * width + x) * 4 + 3] = 255;
    };
    solid(1, 0);
    solid(1, 1);
    for (let y = 0; y < height; y++) {
      solid(2, y);
      solid(3, y);
    }
    const frame = { x: 0, y: 0, width, height, offsetX: 0, offsetY: 0 };
    expect(Array.from(keelLine(buildAlphaMask(rgba, width, height), frame))).toEqual([1, 2, 2, 4, 3, 4]);
  });
});

describe('waterSurfaceAt', () => {
  // Four columns of cells: water in the two west ones, meadow in the two east ones.
  const width = 4;
  const height = 4;
  const ground: SceneGround = {
    patterns: ['block meadow 00', 'block water 01'],
    a: Array.from({ length: width * height }, (_, i) => (i % width < 2 ? 1 : 0)),
    b: Array.from({ length: width * height }, (_, i) => (i % width < 2 ? 1 : 0)),
  };
  const field = makeWaterField(ground, width, height);
  const CELL_W = 68;
  const ROW = 76; // an even row, so its cells carry no stagger

  it('reads 1 over water, 0 over land, and blends across the last cell before the shore', () => {
    expect(waterSurfaceAt(field, 0, ROW)).toBeCloseTo(1);
    expect(waterSurfaceAt(field, 3 * CELL_W, ROW)).toBeCloseTo(0);
    const shore = waterSurfaceAt(field, 1.5 * CELL_W, ROW);
    expect(shore).toBeGreaterThan(0);
    expect(shore).toBeLessThan(1);
  });
});

describe('ShipWakeLayer', () => {
  const drawnAt = (anchor: { x: number; y: number } | undefined): DrawnGeometry => ({
    boundsOf: () => undefined,
    anchorOf: () => anchor,
    keelOf: () => SIDE_KEEL,
  });
  const sailing: ShipAfloat = { ref: 3, facing: FACING_NE, sailing: true };
  const visibleMarks = (layer: ShipWakeLayer): number => {
    const root = layer.container.children[0] as Container;
    const frame = root.children[0] as Container;
    return (frame.children as Sprite[]).filter((g) => g.visible).length;
  };

  it('mints one node per drawn ship and retires it when the ship leaves the list', () => {
    const layer = new ShipWakeLayer();
    layer.draw([sailing], drawnAt({ x: 10, y: 20 }), NO_WATER, 0);
    expect(layer.container.children).toHaveLength(1);
    expect(layer.container.children[0]?.position).toMatchObject({ x: 10, y: 20 });
    layer.draw([], drawnAt({ x: 10, y: 20 }), NO_WATER, 1);
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws the whole wake under sail and only the lapping foam at rest', () => {
    const under = new ShipWakeLayer();
    under.draw([sailing], drawnAt({ x: 0, y: 0 }), NO_WATER, 20);
    const resting = new ShipWakeLayer();
    resting.draw([{ ...sailing, sailing: false }], drawnAt({ x: 0, y: 0 }), NO_WATER, 20);
    expect(visibleMarks(resting)).toBe(LAP_MARKS);
    expect(visibleMarks(under)).toBeGreaterThan(LAP_MARKS);
  });

  it('draws nothing on dry land when the map has a water mask', () => {
    const land = makeWaterField(
      { patterns: ['block meadow 00', 'block water 01'], a: [1, 0, 0, 0], b: [1, 0, 0, 0] },
      2,
      2,
    );
    const layer = new ShipWakeLayer();
    layer.draw([sailing], drawnAt({ x: 5000, y: 5000 }), land, 20);
    expect(visibleMarks(layer)).toBe(0);
  });
});
