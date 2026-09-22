import type { SimEvent } from '@open-northland/sim';
import { clamp01 } from '../math.js';
import { ONE } from '../projection/index.js';
import { frac } from './blood.js';
import type { SmokePuffPose } from './smoke.js';

/**
 * The pure half of the building-collapse transient: `buildingDestroyed` events fold into a list of
 * collapsing buildings the GPU layer draws sinking into the ground behind a dust cloud. Progress is
 * measured in sim ticks, not wall-clock, so a paused game and a `?shot` capture reproduce exactly.
 * Source basis: the original removes a destroyed house's pixel rows bottom-up over time;
 * the constant-rate sink and the procedural dust are approximated.
 */

export interface BuildingCollapse {
  readonly entity: number;
  /** The content building type - the entity leaves the snapshot the tick it dies, so the body sprite
   *  is re-resolved from this. */
  readonly typeId: number;
  /** The owning civilization, the key of the per-tribe building look tables. */
  readonly tribe: number;
  /** Construction progress at destruction, whole percent 0..99; undefined for a finished building. */
  readonly builtPct?: number;
  /** Half-cell node of the building's anchor. */
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
}

/** Ticks a collapse takes from intact to fully sunk (~1.7 s at 12 Hz) - feel-tuned. */
export const COLLAPSE_TICKS = 20;

/** Ticks the ground-line dust cloud outlives the sunk body, settling instead of blinking out. */
export const DUST_SETTLE_TICKS = 10;

export const COLLAPSE_LIFETIME_TICKS = COLLAPSE_TICKS + DUST_SETTLE_TICKS;

/** Concurrent dust puffs along one collapse's ground line - dense enough to swallow the body's
 *  cropped bottom edge rather than decorate it. */
export const DUST_PUFFS = 16;

/** One dust puff's churn loop, in sim ticks. */
const DUST_PERIOD_TICKS = 14;

/** How far a puff rolls outward past the body's edge and how far it rises, in world px. */
const DUST_ROLL_PX = 14;
const DUST_RISE_PX = 14;

/** A dust puff's radius from birth to dissolve, in world px. */
const DUST_MIN_R = 6;
const DUST_MAX_R = 14;

/** Peak opacity of one dust puff. */
const DUST_PEAK_ALPHA = 0.8;

/** Ticks the cloud takes to billow up when the collapse starts. */
const DUST_RAMP_TICKS = 3;

/** The most simultaneous collapses kept alive - bounds the per-frame pass when a whole base falls at
 *  once. Oldest dropped first. */
export const MAX_ACTIVE_COLLAPSES = 60;

/** Sink progress at `tick`: 0 intact, 1 fully underground. */
export function collapseProgress(c: BuildingCollapse, tick: number): number {
  const p = (tick - c.spawnTick) / COLLAPSE_TICKS;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** A stable per-collapse key for the retained GPU pool. */
export function collapseKey(c: BuildingCollapse): string {
  return `${c.entity}:${c.spawnTick}`;
}

/**
 * Dust puff `i` of a collapse at `age` ticks since the crash, in ground-line-local world px. Puffs
 * are seeded along the body's base (`halfWidth` px each side) and loop a short outward roll under a
 * cloud-wide envelope that billows in, holds through the sink, then settles. Deterministic in
 * (seed, i, age).
 */
export function collapseDustPuff(seed: number, i: number, age: number, halfWidth: number): SmokePuffPose {
  const phase = (i * DUST_PERIOD_TICKS) / DUST_PUFFS + frac(seed, i * 17) * DUST_PERIOD_TICKS;
  const looped = (((age + phase) % DUST_PERIOD_TICKS) + DUST_PERIOD_TICKS) % DUST_PERIOD_TICKS;
  const t = looped / DUST_PERIOD_TICKS;
  const side = frac(seed, i * 5 + 1) * 2 - 1; // seeded home spot across the base, either side
  const envelope =
    Math.min(1, age / DUST_RAMP_TICKS) * clamp01((COLLAPSE_LIFETIME_TICKS - age) / DUST_SETTLE_TICKS);
  return {
    x: side * (halfWidth + t * DUST_ROLL_PX),
    y: -(0.4 + 0.6 * frac(seed, i * 5 + 2)) * DUST_RISE_PX * t,
    radius: DUST_MIN_R + (DUST_MAX_R - DUST_MIN_R) * t,
    alpha: Math.min(1, t * 4) * (1 - t) * DUST_PEAK_ALPHA * envelope,
  };
}

/**
 * Fold this frame's `buildingDestroyed` events into the live collapse list, dropping settled
 * collapses and capping the result at {@link MAX_ACTIVE_COLLAPSES} (oldest dropped first).
 */
export function foldBuildingCollapses(
  active: readonly BuildingCollapse[],
  events: readonly SimEvent[],
  tick: number,
): BuildingCollapse[] {
  const next = active.filter((c) => tick - c.spawnTick < COLLAPSE_LIFETIME_TICKS);
  for (const ev of events) {
    if (ev.kind !== 'buildingDestroyed' || ev.at === undefined) continue;
    // An unfinished site collapses as its construction stage, on the same whole-percent scale the
    // live construction reveal uses.
    const builtPct =
      ev.built < ONE ? Math.min(99, Math.max(0, Math.floor((ev.built * 100) / ONE))) : undefined;
    next.push({
      entity: ev.entity,
      typeId: ev.buildingType,
      tribe: ev.tribe,
      ...(builtPct !== undefined ? { builtPct } : {}),
      hx: ev.at.hx,
      hy: ev.at.hy,
      spawnTick: tick,
    });
  }
  if (next.length > MAX_ACTIVE_COLLAPSES) next.splice(0, next.length - MAX_ACTIVE_COLLAPSES);
  return next;
}
