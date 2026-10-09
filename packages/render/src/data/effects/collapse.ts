import type { SimEvent } from '@open-northland/sim';
import { clamp01 } from '../math.js';
import { ONE } from '../projection/index.js';

/**
 * The pure half of the building-collapse transient: `buildingDestroyed` events fold into a list of
 * collapsing buildings whose last visible layers unwind through their construction order. Progress is
 * measured in sim ticks, not wall-clock, so a paused game and a `?shot` capture reproduce exactly.
 * Reverse construction, chip motion and procedural dust are artistic approximations.
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

/** Artistic pacing for readability at ×3: smoke and accelerating removal take one real second.
 * Presentation deliberately outlives the simulation's ruin delay. */
export const COLLAPSE_SMOKE_LEAD_TICKS = 6;
export const COLLAPSE_TICKS = 30;

/** Ticks reserved for airborne dust to disperse after the structure is gone. */
export const DUST_SETTLE_TICKS = 100;
export const COLLAPSE_LIFETIME_TICKS = COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS + DUST_SETTLE_TICKS;

/** The most simultaneous collapses kept alive - bounds the per-frame pass when a whole base falls at
 *  once. Oldest dropped first. */
export const MAX_ACTIVE_COLLAPSES = 60;

/** Breakup progress at `tick`: 0 unchanged, 1 no standing structure. */
export function collapseProgress(c: BuildingCollapse, tick: number): number {
  const p = clamp01((tick - c.spawnTick - COLLAPSE_SMOKE_LEAD_TICKS) / COLLAPSE_TICKS);
  return p * p;
}

/** Inverse of the accelerating body curve: chips detach when their source pixels disappear. */
export function collapseRemovalAge(progress: number): number {
  return COLLAPSE_SMOKE_LEAD_TICKS + Math.sqrt(clamp01(progress)) * COLLAPSE_TICKS;
}

/** A stable per-collapse key for the retained GPU pool. */
export function collapseKey(c: BuildingCollapse): string {
  return `${c.entity}:${c.spawnTick}`;
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
