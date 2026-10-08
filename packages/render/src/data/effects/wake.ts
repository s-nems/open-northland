import { TILE_HALF_H, TILE_HALF_W } from '../projection/index.js';
import { frac } from './random.js';

/**
 * The water a ship pushes aside - an Open Northland enhancement; the original draws no water around
 * its ships. Every pose is a pure function of render time and the fitted hull, in the hull's ground
 * frame: `x` forward along the heading, `y` to starboard, world px on the water plane before the
 * {@link WATER_PLANE_SQUASH}. Sizes, speeds and alphas are eye-calibrated approximations.
 */

/** Screen y per ground y. The half-cell lattice is a regular hexagon on the water plane: its diagonal
 *  step (`TILE_HALF_W / 2`, `TILE_HALF_H / 2`) is as long there as the straight `TILE_HALF_W` one. */
export const WATER_PLANE_SQUASH = TILE_HALF_H / 2 / (TILE_HALF_W * Math.sin(Math.PI / 3));

const DEG = Math.PI / 180;
/** The ground-plane angle of a diagonal hull off the east-west line. Observation of the ship frames: a
 *  diagonal hull is drawn along the 2:1 pixel-art diagonal, far flatter than the 60-degree lattice step
 *  it sails, so the wake follows the drawn hull rather than the course. */
const DRAWN_DIAGONAL = Math.atan(1 / 2 / WATER_PLANE_SQUASH);
/** The ground-plane angle (radians, y down) a hull is drawn along per render facing
 *  `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`. */
const FACING_HEADING: readonly number[] = [
  Math.PI - DRAWN_DIAGONAL,
  Math.PI,
  DRAWN_DIAGONAL - Math.PI,
  -DRAWN_DIAGONAL,
  0,
  DRAWN_DIAGONAL,
  90 * DEG,
  -90 * DEG,
];

export function facingHeading(facing: number): number {
  return FACING_HEADING[facing] ?? 0;
}

/** Ticks a ship takes per lattice node on open water: the move period `2g + 4` at the roughness `g = 1`
 *  nine in ten water cells read (docs/formats/VEHICLES.md). */
const OPEN_WATER_TICKS_PER_NODE = 6;
/** How far the water drifts past a sailing hull per tick. Crests left at this speed stay put on the
 *  water; over rougher water the ship is slower and they trail a little. */
export const WAKE_DRIFT_PX_PER_TICK = TILE_HALF_W / OPEN_WATER_TICKS_PER_NODE;

/** A hull's waterline ellipse in its ground frame; {@link beam} is the half-width and {@link centreline}
 *  the centre line's offset to starboard of the anchor. */
export interface Hull {
  bow: number;
  stern: number;
  beam: number;
  centreline: number;
}

/** Half-beam per waterline length of both ship hulls. Observation of the ship frames: the end-on ones
 *  show a half-beam about 0.16 of the length the side-on ones show. A side-on or diagonal keel line only
 *  shows the near side, so the far side is placed by this proportion. */
const HALF_BEAM_PER_LENGTH = 0.16;
/** The hull a ship draws without a readable keel line. */
const DEFAULT_HULL_LENGTH = 6 * TILE_HALF_W;
/** Screen px a keel line may rise per px across toward either end and still be waterline. A steeper rise
 *  leaves the water for a stem post, a figurehead or a sail's hem. */
const WATERLINE_MAX_RISE = 2.5;
/** Half-beams past the centre line, toward the far side, that an end of the waterline may lie: a diagonal
 *  hull's leftmost and rightmost points sit a little off it. A keel point further over is a stem or stern
 *  rising out of the water. */
const WATERLINE_END_SLACK = 0.5;

/**
 * Fit `out` to a ship's keel line: `keel` holds the lowest drawn texel per sampled column as
 * anchor-relative world px `(x, y)` pairs, left to right, each read as a point on the water plane. Only
 * the waterline stretch is read, walking out from the lowest point until the line rises steeply.
 */
export function fitHull(keel: readonly number[] | undefined, heading: number, out: Hull): Hull {
  if (keel === undefined || !readWaterline(keel, heading)) {
    out.bow = DEFAULT_HULL_LENGTH / 2;
    out.stern = -DEFAULT_HULL_LENGTH / 2;
    out.beam = DEFAULT_HULL_LENGTH * HALF_BEAM_PER_LENGTH;
    out.centreline = 0;
    return out;
  }
  // Heading up or down the screen, the keel line runs across the hull rather than along it.
  if (Math.abs(span.sin) * WATER_PLANE_SQUASH > Math.abs(span.cos)) return fitEndOn(out);
  return fitSideOn(out);
}

/** The keel line being fitted: its waterline stretch, points `first..last`, read in the frame of a hull
 *  on `cos`/`sin`. Scratch, so a fit allocates nothing per frame. */
const span = { keel: [] as readonly number[], first: 0, last: 0, cos: 1, sin: 0 };
/** {@link alongRange}'s answer. */
const range = { stern: 0, bow: 0 };

/** Point {@link span} at `keel`'s waterline stretch for `heading`: from the lowest point out to either
 *  side, up to where the line rises more steeply than {@link WATERLINE_MAX_RISE}. False when the
 *  stretch is under two points. */
function readWaterline(keel: readonly number[], heading: number): boolean {
  const points = Math.floor(keel.length / 2);
  let lowest = 0;
  for (let p = 1; p < points; p++) if (yAt(keel, p) > yAt(keel, lowest)) lowest = p;
  let first = lowest;
  while (first > 0 && waterlineStep(keel, first, first - 1)) first--;
  let last = lowest;
  while (last + 1 < points && waterlineStep(keel, last, last + 1)) last++;
  span.keel = keel;
  span.first = first;
  span.last = last;
  span.cos = Math.cos(heading);
  span.sin = Math.sin(heading);
  return last > first;
}

/**
 * A hull seen from the side or on a diagonal: the keel line is its near waterline, from stem to stern.
 * The midships points place the near side; the far side lies a proportional beam behind it. End points
 * standing above the waterline, a stem or stern rising out of the water, do not lengthen the hull.
 */
function fitSideOn(out: Hull): Hull {
  // +1 when starboard lies down the screen, toward the viewer.
  const near = span.cos > 0 ? 1 : -1;
  alongRange(near, -Infinity);
  const { stern, bow } = range;
  const waterline = midshipsLateral(stern, bow);
  const roughBeam = (bow - stern) * HALF_BEAM_PER_LENGTH;
  alongRange(near, near * waterline - (1 + WATERLINE_END_SLACK) * roughBeam);
  // The midships points always pass; the guard only covers a keel line without any.
  const afloat = range.bow > range.stern;
  out.bow = afloat ? range.bow : bow;
  out.stern = afloat ? range.stern : stern;
  out.beam = (out.bow - out.stern) * HALF_BEAM_PER_LENGTH;
  out.centreline = waterline - near * out.beam;
  return out;
}

/** The mean lateral offset of the keel points in the middle half of `stern..bow`, clear of the ends
 *  where the waterline curves in: where the near side runs, which a lone bump does not move. */
function midshipsLateral(stern: number, bow: number): number {
  const centre = (bow + stern) / 2;
  const midships = (bow - stern) / 4;
  let sum = 0;
  let count = 0;
  for (let p = span.first; p <= span.last; p++) {
    if (Math.abs(alongOf(p) - centre) > midships) continue;
    sum += lateralOf(p);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** Set {@link range} to the sternmost and bowmost place of the keel points whose offset toward the `near`
 *  side is at least `least`. */
function alongRange(near: number, least: number): void {
  range.stern = Infinity;
  range.bow = -Infinity;
  for (let p = span.first; p <= span.last; p++) {
    if (near * lateralOf(p) < least) continue;
    const along = alongOf(p);
    range.stern = Math.min(range.stern, along);
    range.bow = Math.max(range.bow, along);
  }
}

/**
 * A hull seen end-on, heading up or down the screen: the keel line rounds its near end, bow or stern,
 * and spans its beam. The far end, up the screen, hides behind the hull a proportional length away.
 */
function fitEndOn(out: Hull): Hull {
  let port = Infinity;
  let starboard = -Infinity;
  for (let p = span.first; p <= span.last; p++) {
    port = Math.min(port, lateralOf(p));
    starboard = Math.max(starboard, lateralOf(p));
  }
  alongRange(1, -Infinity);
  const { stern, bow } = range;
  const beam = (starboard - port) / 2;
  const length = beam / HALF_BEAM_PER_LENGTH;
  if (span.sin < 0) {
    out.stern = stern;
    out.bow = stern + length;
  } else {
    out.bow = bow;
    out.stern = bow - length;
  }
  out.beam = beam;
  out.centreline = (starboard + port) / 2;
  return out;
}

/** Whether the keel line stays waterline from point `from` out to its neighbour `to`. */
function waterlineStep(keel: readonly number[], from: number, to: number): boolean {
  const rise = yAt(keel, from) - yAt(keel, to);
  return rise <= WATERLINE_MAX_RISE * Math.abs(xAt(keel, to) - xAt(keel, from));
}

function xAt(keel: readonly number[], point: number): number {
  return keel[2 * point] ?? 0;
}

function yAt(keel: readonly number[], point: number): number {
  return keel[2 * point + 1] ?? 0;
}

/** Keel point `p`'s place along the heading, on the water plane. */
function alongOf(p: number): number {
  return xAt(span.keel, p) * span.cos + (yAt(span.keel, p) / WATER_PLANE_SQUASH) * span.sin;
}

/** Keel point `p`'s offset to starboard of the anchor, on the water plane. */
function lateralOf(p: number): number {
  return -xAt(span.keel, p) * span.sin + (yAt(span.keel, p) / WATER_PLANE_SQUASH) * span.cos;
}

/** One foam or crest mark in the hull's ground frame: an ellipse at (`x`, `y`) with radii `rx` along its
 *  `rotation` and `ry` across it. A negative `ry` mirrors the mark's inner side. */
export interface WakeMark {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
  alpha: number;
}

/** Foam marks ringing the hull where it meets the water. */
export const LAP_MARKS = 24;
const LAP_RADIUS_PX = 8;
const LAP_PERIOD_TICKS = 20;
const LAP_PULSE = 0.35;
/** Lapping phase advance from one foam mark to the next, so neighbours never swell in step. */
const LAP_PHASE_STEP = 2.4;
/** Lapping foam is drawn longer along the hull than across it. */
const LAP_STRETCH = 1.5;
const LAP_ALPHA_AT_REST = 0.5;
const LAP_ALPHA_SAILING = 1;
/** Under way, the water piles up at the bow: its foam grows by this much and stands this far ahead. */
const BOW_BUNCH = 1.6;
const BOW_PUSH_PX = 10;

/**
 * Lapping foam mark `i` along the hull's waterline at `time`; `sail` in [0, 1] blends it from the idle
 * lap to the pushed bow cushion of a ship under way.
 */
export function lapMark(i: number, time: number, hull: Hull, sail: number, out: WakeMark): WakeMark {
  const angle = (i / LAP_MARKS) * 2 * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centre = (hull.bow + hull.stern) / 2;
  const half = (hull.bow - hull.stern) / 2;
  const forward = cos > 0 ? cos : 0;
  const push = sail * BOW_PUSH_PX * forward * forward;
  out.x = centre + half * cos + push;
  out.y = hull.centreline + hull.beam * sin;
  const pulse = 1 + LAP_PULSE * Math.sin((time / LAP_PERIOD_TICKS) * 2 * Math.PI + i * LAP_PHASE_STEP);
  const radius = LAP_RADIUS_PX * pulse * (1 + sail * BOW_BUNCH * forward);
  out.rx = radius * LAP_STRETCH;
  out.ry = radius;
  // Tangent to the ellipse, so the foam hugs the planking rather than dotting it.
  out.rotation = Math.atan2(hull.beam * cos, -half * sin);
  out.alpha = LAP_ALPHA_AT_REST + (LAP_ALPHA_SAILING - LAP_ALPHA_AT_REST) * sail;
  return out;
}

/** Crests per arm of the bow wave's V. */
export const CRESTS_PER_ARM = 14;
/** A crest's life from the bow to where it has flattened out. */
const CREST_LIFE_TICKS = 64;
/** The Kelvin half-angle a moving hull's divergent waves trail at (about 19.5 degrees). */
const KELVIN_TAN = Math.tan(Math.asin(1 / 3));
/** A divergent crest lies across its arm at about 35 degrees to the course, so the arm reads as a row of
 *  short feathered ridges rather than one line. */
const CREST_FEATHER = 35 * DEG;
const CREST_LENGTH_PX: readonly [number, number] = [9, 22];
const CREST_WIDTH_PX: readonly [number, number] = [3.5, 5.5];
/** Of a crest's life, the fraction it takes to fade in at the bow. */
const CREST_FADE_IN = 0.08;
/** Per-mark variation, so no two ridges or puffs match: a mark's size and a crest's strength vary by up
 *  to these fractions, a crest's place off its arm by up to this many px. */
const SIZE_JITTER = 0.5;
const CREST_ALPHA_JITTER = 0.45;
const CREST_OFFSET_JITTER_PX = 6;
/** Keeps each mark's reseeded variation apart from its neighbours'. */
const MARK_SEED_STRIDE = 7919;

/**
 * Crest `i` of the bow wave's `side` arm (+1 starboard, -1 port) at `time`: born at the bow and left on
 * the water as the hull sails on, it slides aft along the hull's side and then out along the Kelvin
 * wedge, lengthening and fading. The ship's `seed` varies every crest it sheds.
 */
export function crestMark(
  i: number,
  side: 1 | -1,
  time: number,
  hull: Hull,
  sail: number,
  seed: number,
  out: WakeMark,
): WakeMark {
  const phased = time + (i * CREST_LIFE_TICKS) / CRESTS_PER_ARM;
  const t = cycle(phased, CREST_LIFE_TICKS);
  const key = (i * 2 + (side > 0 ? 1 : 0)) * MARK_SEED_STRIDE + generation(phased, CREST_LIFE_TICKS);
  const behind = t * CREST_LIFE_TICKS * WAKE_DRIFT_PX_PER_TICK;
  const x = hull.bow - behind;
  const spread = behind * KELVIN_TAN + (frac(seed, key) - 0.5) * 2 * CREST_OFFSET_JITTER_PX * t;
  const hug = hullHalfWidth(hull, x);
  out.x = x;
  out.y = hull.centreline + side * Math.sqrt(spread * spread + hug * hug);
  out.rx = mix(CREST_LENGTH_PX, t) * (1 - SIZE_JITTER * frac(seed, key + 1));
  out.ry = side * mix(CREST_WIDTH_PX, t);
  out.rotation = -side * CREST_FEATHER;
  const strength = 1 - CREST_ALPHA_JITTER * frac(seed, key + 2);
  out.alpha = sail * strength * Math.min(1, t / CREST_FADE_IN) * (1 - t);
  return out;
}

/** Foam puffs churned up behind the stern. */
export const WASH_PUFFS = 20;
const WASH_LIFE_TICKS = 44;
const WASH_RADIUS_PX: readonly [number, number] = [6, 16];
/** Wash foam streams out along the track, longer than foam elsewhere. */
const WASH_STRETCH = 2.2;
const WASH_ALPHA = 0.55;
/** A puff's sideways scatter in half-beams: born across the stern, spreading by the end of its life. */
const WASH_SCATTER: readonly [number, number] = [0.4, 1.4];

/** Stern wash puff `i` at `time`, scattered by the ship's `seed`. */
export function washMark(
  i: number,
  time: number,
  hull: Hull,
  sail: number,
  seed: number,
  out: WakeMark,
): WakeMark {
  const phased = time + (i * WASH_LIFE_TICKS) / WASH_PUFFS;
  const t = cycle(phased, WASH_LIFE_TICKS);
  const key = i * MARK_SEED_STRIDE + generation(phased, WASH_LIFE_TICKS);
  const scatter = (frac(seed, key) - 0.5) * 2;
  const radius = mix(WASH_RADIUS_PX, t) * (1 - SIZE_JITTER * frac(seed, key + 1));
  out.x = hull.stern - t * WASH_LIFE_TICKS * WAKE_DRIFT_PX_PER_TICK;
  out.y = hull.centreline + scatter * hull.beam * mix(WASH_SCATTER, t);
  out.rx = radius * WASH_STRETCH;
  out.ry = radius;
  out.rotation = 0;
  out.alpha = sail * WASH_ALPHA * Math.min(1, t / CREST_FADE_IN) * (1 - t);
  return out;
}

/** The hull ellipse's half-width at `x`, 0 beyond the stem and stern. */
function hullHalfWidth(hull: Hull, x: number): number {
  const half = (hull.bow - hull.stern) / 2;
  const u = (x - (hull.bow + hull.stern) / 2) / half;
  return u * u >= 1 ? 0 : hull.beam * Math.sqrt(1 - u * u);
}

/** Which pass of its loop a mark is on: a new pass is a new mark, reseeded. */
function generation(time: number, period: number): number {
  return Math.floor(time / period);
}

/** `time`'s position in a loop of `period` ticks, in [0, 1). */
function cycle(time: number, period: number): number {
  return (((time % period) + period) % period) / period;
}

function mix(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/** Ticks the wake takes to rise when a ship gets under way and to settle when it stops. */
const SAIL_FADE_TICKS = 18;

/** Step a ship's under-way blend toward 1 while `sailing`, toward 0 otherwise, over `dt` ticks. */
export function stepSailBlend(blend: number, sailing: boolean, dt: number): number {
  const step = Math.max(0, dt) / SAIL_FADE_TICKS;
  return sailing ? Math.min(1, blend + step) : Math.max(0, blend - step);
}
