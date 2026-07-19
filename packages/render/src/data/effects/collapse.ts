import type { SimEvent } from '@open-northland/sim';
import { clamp01 } from '../math.js';
import { ONE } from '../projection/index.js';
import { frac } from './blood.js';
import type { SmokePuffPose } from './smoke.js';

/**
 * The pure half of the building-collapse transient: `buildingDestroyed` events (combat raze and player
 * demolish share the one cue) fold into a short-lived list of collapsing buildings the GPU layer draws —
 * the last-drawn body sinking into the ground, its lowest pixel rows clipped at the ground line, behind
 * a churning dust cloud along the ground line that hides the crop edge and settles after the body is
 * gone. Progress is measured in sim ticks, not wall-clock, so a `?shot` capture and a paused game
 * reproduce exactly. Source basis: the original blits a destroyed house through
 * `PrintBob_UsingCollapseTimeMask` (OpenVikings `CBobManager`) — rows removed bottom-up over time; the
 * constant-rate sink and the procedural dust are the approximated half (the original's rate curve and
 * debris art are not decoded).
 */

/** One collapsing building: where it stood, which body to draw, and when it started sinking. */
export interface BuildingCollapse {
  /** The razed entity id — with `spawnTick`, the retained-pool key (ids are never recycled). */
  readonly entity: number;
  /** The content building type (`buildingDestroyed.buildingType`) — re-resolves the body sprite, since
   *  the entity left the snapshot the tick it died. */
  readonly typeId: number;
  /** Construction progress at destruction as a whole percent (0..99), undefined for a finished building —
   *  an unfinished site collapses as its construction-stage body, not the complete one. */
  readonly builtPct?: number;
  /** Half-cell node of the building's anchor (the event's `at`). */
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
}

/** Ticks a collapse takes from intact to fully sunk (~1.7 s at 12 Hz) — feel-tuned; see the module note. */
export const COLLAPSE_TICKS = 20;

/** Ticks the ground-line dust cloud outlives the sunk body — it settles instead of blinking out with it. */
export const DUST_SETTLE_TICKS = 10;

/** A collapse lives this long in total: the sink window plus the dust settling over the empty plot. */
export const COLLAPSE_LIFETIME_TICKS = COLLAPSE_TICKS + DUST_SETTLE_TICKS;

/** Concurrent dust puffs churning along one collapse's ground line (dense — the cloud must swallow the
 *  body's cropped bottom edge, not decorate it). */
export const DUST_PUFFS = 16;

/** One dust puff's churn loop, in sim ticks — shorter than the smoke rise; dust rolls, it doesn't plume. */
const DUST_PERIOD_TICKS = 14;

/** How far a puff rolls outward past the body's edge and how little it rises, in world px. */
const DUST_ROLL_PX = 14;
const DUST_RISE_PX = 14;

/** A dust puff's radius from birth to dissolve, in world px. */
const DUST_MIN_R = 6;
const DUST_MAX_R = 14;

/** Peak opacity of one dust puff (many overlap along the base, so the cloud reads near-solid). */
const DUST_PEAK_ALPHA = 0.8;

/** Ticks the cloud takes to billow up when the collapse starts. */
const DUST_RAMP_TICKS = 3;

/** The most simultaneous collapses kept alive — bounds the per-frame pass when a whole base falls at
 *  once (golden rule: cost tracks the screen). Oldest dropped first; each lives under 2 s anyway. */
export const MAX_ACTIVE_COLLAPSES = 60;

/** Sink progress at `tick`: 0 = intact, 1 = fully underground (the layer then retires the node). */
export function collapseProgress(c: BuildingCollapse, tick: number): number {
  const p = (tick - c.spawnTick) / COLLAPSE_TICKS;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** A stable per-collapse key for the retained GPU pool. */
export function collapseKey(c: BuildingCollapse): string {
  return `${c.entity}:${c.spawnTick}`;
}

/**
 * Dust puff `i` of a collapse at `age` ticks since the crash, in ground-line-local world px:
 * seeded along the body's base (`halfWidth` px each side, spilling a little past the edges), each
 * loops a short roll — swelling outward and slightly up, thinning as it grows — under a cloud-wide
 * envelope that billows in over {@link DUST_RAMP_TICKS}, holds through the sink, and settles to
 * nothing over {@link DUST_SETTLE_TICKS}. Deterministic in (seed, i, age).
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
 * Fold this frame's sim events into the live collapse list: drop settled collapses (sink window plus
 * dust tail), then append one for each `buildingDestroyed` carrying a position and a resolvable type.
 * Capped at {@link MAX_ACTIVE_COLLAPSES} (oldest-first drop). Returns a new array; pure over its inputs.
 */
export function foldBuildingCollapses(
  active: readonly BuildingCollapse[],
  events: readonly SimEvent[],
  tick: number,
): BuildingCollapse[] {
  const next = active.filter((c) => tick - c.spawnTick < COLLAPSE_LIFETIME_TICKS);
  for (const ev of events) {
    if (ev.kind !== 'buildingDestroyed' || ev.at === undefined) continue;
    // An unfinished site (built < ONE) collapses as its construction stage — the same whole-percent
    // scale the live construction reveal uses — never as the finished body it never became.
    const builtPct =
      ev.built < ONE ? Math.min(99, Math.max(0, Math.floor((ev.built * 100) / ONE))) : undefined;
    next.push({
      entity: ev.entity,
      typeId: ev.buildingType,
      ...(builtPct !== undefined ? { builtPct } : {}),
      hx: ev.at.hx,
      hy: ev.at.hy,
      spawnTick: tick,
    });
  }
  if (next.length > MAX_ACTIVE_COLLAPSES) next.splice(0, next.length - MAX_ACTIVE_COLLAPSES);
  return next;
}
