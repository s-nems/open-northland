import { clamp01, lerp } from '../math.js';
import { ONE, tileToScreen } from '../projection/index.js';
import { type ElevationField, elevationLiftPerUnit, terrainLiftAt } from '../terrain/index.js';

/**
 * A siege shot's drawn flight. The sim moves the stone along its release chord in equal steps, reaching
 * the aim the tick before its land tick; the render draws the same chord at the frame's own time and lifts
 * it by a parabola from the ground height at the catapult to the ground height at the landing point.
 *
 * Original behavior: the lift rises `terrain at the start + 0.1 of the full height scale` above the
 * chord at mid-flight, raised wherever the path would dip under the ground, so on low ground a stone
 * barely lobs. Open Northland keeps that height as a floor and lobs a longer shot higher
 * ({@link LOB_FRACTION}), which reads the range at a glance.
 */

/** A siege projectile as the snapshot carries it: its id, munition and release chord in tile units. */
export interface SiegeShot {
  readonly ref: number;
  readonly munitionType: number;
  readonly launchTick: number;
  readonly flightTicks: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly aim: { readonly x: number; readonly y: number };
}

/** The drawn path of one shot, resolved once: the chord's projected ends, the ground heights under
 *  them, and the lob's peak above the chord, all in screen px. */
export interface ShotPath {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly fromLift: number;
  readonly toLift: number;
  readonly peak: number;
}

/** Where a shot is at a fraction flown: the chord point (pre-lift screen px) and its height. */
export interface ShotPose {
  readonly x: number;
  readonly y: number;
  readonly lift: number;
}

/** The original's lob floor: a tenth of its 250-step height scale, in elevation units. */
const APEX_CLEARANCE_UNITS = 25;
/** The lob's peak as a fraction of the chord's screen length, clamped to {@link LOB_MIN_PX}..
 *  {@link LOB_MAX_PX}: a 16-point shot east-west peaks near 136 px. */
const LOB_FRACTION = 0.25;
const LOB_MIN_PX = 40;
const LOB_MAX_PX = 150;
/** How many points along the chord the ground-clearance pass samples (the original samples every 5
 *  ticks, 8 or 9 points on a full-range shot). */
const CLEARANCE_SAMPLES = 8;

/** Read a siege projectile off its snapshot components, or null for an arrow or an unreadable one. */
export function readSiegeShot(ref: number, components: Readonly<Record<string, unknown>>): SiegeShot | null {
  const p = components.Projectile as Record<string, unknown> | undefined;
  if (p === undefined || p.impact === null || p.impact === undefined) return null;
  const { originX, originY, aimX, aimY, launchTick, landTick, munitionType } = p;
  if (
    typeof originX !== 'number' ||
    typeof originY !== 'number' ||
    typeof aimX !== 'number' ||
    typeof aimY !== 'number' ||
    typeof launchTick !== 'number' ||
    typeof landTick !== 'number' ||
    typeof munitionType !== 'number'
  ) {
    return null;
  }
  return {
    ref,
    munitionType,
    launchTick,
    // The sim's chord span: the shot sits on the aim from the tick before it lands.
    flightTicks: Math.max(1, landTick - launchTick - 1),
    origin: { x: originX / ONE, y: originY / ONE },
    aim: { x: aimX / ONE, y: aimY / ONE },
  };
}

/** Resolve a shot's drawn path over `elevation`. */
export function shotPath(shot: SiegeShot, elevation: ElevationField | undefined): ShotPath {
  const from = tileToScreen(shot.origin.x, shot.origin.y);
  const to = tileToScreen(shot.aim.x, shot.aim.y);
  const fromLift = terrainLiftAt(elevation, shot.origin.x, shot.origin.y);
  const toLift = terrainLiftAt(elevation, shot.aim.x, shot.aim.y);
  const clearance = APEX_CLEARANCE_UNITS * elevationLiftPerUnit();
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  let peak = Math.max(fromLift + clearance, Math.min(LOB_MAX_PX, Math.max(LOB_MIN_PX, chord * LOB_FRACTION)));
  for (let i = 1; i < CLEARANCE_SAMPLES; i++) {
    const p = i / CLEARANCE_SAMPLES;
    const ground = terrainLiftAt(
      elevation,
      lerp(shot.origin.x, shot.aim.x, p),
      lerp(shot.origin.y, shot.aim.y, p),
    );
    const bump = 4 * p * (1 - p);
    peak = Math.max(peak, (ground + clearance - lerp(fromLift, toLift, p)) / bump);
  }
  return { from, to, fromLift, toLift, peak };
}

/** The shot's pose `flown` ticks after launch (fractional), clamped to the chord's ends. */
export function shotPoseAt(path: ShotPath, shot: SiegeShot, flown: number): ShotPose {
  const p = clamp01(flown / shot.flightTicks);
  return {
    x: lerp(path.from.x, path.to.x, p),
    y: lerp(path.from.y, path.to.y, p),
    lift: lerp(path.fromLift, path.toLift, p) + 4 * path.peak * p * (1 - p),
  };
}

/** The ground height under the shot `flown` ticks after launch, where its shadow falls. */
export function shotGroundLift(
  shot: SiegeShot,
  elevation: ElevationField | undefined,
  flown: number,
): number {
  const p = clamp01(flown / shot.flightTicks);
  return terrainLiftAt(elevation, lerp(shot.origin.x, shot.aim.x, p), lerp(shot.origin.y, shot.aim.y, p));
}
