import type { SimEvent } from '@open-northland/sim';
import { clamp01 } from '../math.js';

/**
 * The pure half of a destroyed ship's transient: it burns and goes down where it lay. Ages are sim
 * ticks, so a paused game and a `?shot` capture reproduce exactly. The pace and the curves are an
 * artistic approximation.
 */

export interface ShipSinking {
  readonly entity: number;
  readonly spawnTick: number;
}

/** A hull takes this long to go under. */
export const SINK_TICKS = 48;
/** The smoke over the water thins out for this long after it. */
const SINK_SMOKE_TAIL_TICKS = 24;
export const SINKING_LIFETIME_TICKS = SINK_TICKS + SINK_SMOKE_TAIL_TICKS;
/** The share of the dive the fire and smoke stay whole for. */
const SMOKE_HOLD = 0.7;

/** The most sinkings kept alive: a defeated seat loses every ship on one tick. Oldest dropped first. */
export const MAX_ACTIVE_SINKINGS = 24;

/** A wreck that leaves no ruin on the ground lay on the water; a scripted removal is silent. */
function sinks(ev: SimEvent): ev is SimEvent & { kind: 'vehicleDestroyed' } {
  return ev.kind === 'vehicleDestroyed' && ev.cause !== 'script' && ev.ruins.length === 0;
}

export function foldShipSinkings(
  active: readonly ShipSinking[],
  events: readonly SimEvent[],
  tick: number,
): readonly ShipSinking[] {
  const settled = active.some((s) => tick - s.spawnTick >= SINKING_LIFETIME_TICKS);
  if (!settled && !events.some(sinks)) return active;
  const next = active.filter((s) => tick - s.spawnTick < SINKING_LIFETIME_TICKS);
  for (const ev of events) if (sinks(ev)) next.push({ entity: ev.entity, spawnTick: tick });
  if (next.length > MAX_ACTIVE_SINKINGS) next.splice(0, next.length - MAX_ACTIVE_SINKINGS);
  return next;
}

/** How far under a hull is at `age`: 0 afloat, 1 gone. It settles slowly, then slides. */
export function sinkProgress(age: number): number {
  return clamp01(age / SINK_TICKS) ** 1.7;
}

/** The fire and smoke of a sinking hull: whole while it stands out of the water, gone with the tail. */
export function sinkSmokeAlpha(age: number): number {
  const fadeFrom = SINK_TICKS * SMOKE_HOLD;
  return 1 - clamp01((age - fadeFrom) / (SINKING_LIFETIME_TICKS - fadeFrom));
}
