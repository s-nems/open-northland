import type { SimEvent } from '@open-northland/sim';

/**
 * The pure half of the building-collapse transient: `buildingDestroyed` events (combat raze and player
 * demolish share the one cue) fold into a short-lived list of collapsing buildings the GPU layer draws —
 * the last-drawn body sinking into the ground, its lowest pixel rows clipped at the ground line. Progress
 * is measured in sim ticks, not wall-clock, so a `?shot` capture and a paused game reproduce exactly.
 * Source basis: the original blits a destroyed house through `PrintBob_UsingCollapseTimeMask`
 * (OpenVikings `CBobManager`) — rows removed bottom-up over time; the constant-rate sink is the
 * approximated half (the original's rate curve is not decoded).
 */

/** One collapsing building: where it stood, which body to draw, and when it started sinking. */
export interface BuildingCollapse {
  /** The razed entity id — with `spawnTick`, the retained-pool key (ids are never recycled). */
  readonly entity: number;
  /** The content building type (`buildingDestroyed.buildingType`) — re-resolves the body sprite, since
   *  the entity left the snapshot the tick it died. */
  readonly typeId: number;
  /** Half-cell node of the building's anchor (the event's `at`). */
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
}

/** Ticks a collapse takes from intact to fully sunk (~1.7 s at 12 Hz) — feel-tuned; see the module note. */
export const COLLAPSE_TICKS = 20;

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
 * Fold this frame's sim events into the live collapse list: drop finished collapses, then append one for
 * each `buildingDestroyed` carrying a position and a resolvable type. Capped at
 * {@link MAX_ACTIVE_COLLAPSES} (oldest-first drop). Returns a new array; pure over its inputs.
 */
export function foldBuildingCollapses(
  active: readonly BuildingCollapse[],
  events: readonly SimEvent[],
  tick: number,
): BuildingCollapse[] {
  const next = active.filter((c) => tick - c.spawnTick < COLLAPSE_TICKS);
  for (const ev of events) {
    if (ev.kind !== 'buildingDestroyed' || ev.at === undefined) continue;
    next.push({
      entity: ev.entity,
      typeId: ev.buildingType,
      hx: ev.at.hx,
      hy: ev.at.hy,
      spawnTick: tick,
    });
  }
  if (next.length > MAX_ACTIVE_COLLAPSES) next.splice(0, next.length - MAX_ACTIVE_COLLAPSES);
  return next;
}
