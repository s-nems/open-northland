import type { SimEvent } from '@open-northland/sim';
import { heldFadeAlpha } from './fade.js';

/**
 * The wreck-debris lifecycle: the event → mark fold and the decay the layer fades marks by. Ages are
 * measured in sim ticks, not wall-clock, so a paused game and a `?shot` capture reproduce exactly.
 */

export interface WreckMark {
  /** Half-cell node coordinates. */
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
  /** Per-mark jitter seed from the source entity and tick - deterministic, no `Math.random`. */
  readonly seed: number;
}

/**
 * How long a wreck's debris lingers, in sim ticks. Approximation: the original scatters a ruin
 * landscape over the footprint, whose type and decay are not identified (docs/formats/VEHICLES.md).
 */
export const WRECK_LIFETIME_TICKS = 1800;
/** The fraction of a mark's lifetime it holds full opacity before fading over the remaining tail. */
const WRECK_FADE_HOLD = 0.8;
/** The most marks kept alive at once, bounding the per-frame pass; oldest dropped first. */
export const MAX_ACTIVE_WRECKS = 400;

/** A mark's opacity at `tick`. */
export function wreckAlpha(mark: WreckMark, tick: number): number {
  return heldFadeAlpha(tick - mark.spawnTick, WRECK_LIFETIME_TICKS, WRECK_FADE_HOLD);
}

/** Whether `ev` adds a mark in {@link foldWreckMarks}. */
function raisesMark(ev: SimEvent): boolean {
  return ev.kind === 'vehicleDestroyed' && ev.ruins.length > 0;
}

/** Mix a source entity id and the tick into a 32-bit seed, distinct per (source, tick). */
function seedFrom(sourceId: number, tick: number): number {
  return (Math.imul(sourceId, 2654435761) + Math.imul(tick, 40503)) >>> 0;
}

/** Ruin nodes beyond this stride into one event share a seed's neighbour; a footprint is a hex disc of
 *  radius at most 2 (19 nodes), so it never reaches it. */
const RUIN_SEED_STRIDE = 64;

/** Debris per vehicle ruin node, and a capped expiry queue; ships carry no ruin nodes. */
export function foldWreckMarks(
  active: readonly WreckMark[],
  events: readonly SimEvent[],
  tick: number,
): readonly WreckMark[] {
  // Called every frame: a frame that raised and expired nothing keeps the list it was handed.
  const expired = active.some((e) => tick - e.spawnTick >= WRECK_LIFETIME_TICKS);
  if (!expired && !events.some(raisesMark)) return active;
  const next = active.filter((e) => tick - e.spawnTick < WRECK_LIFETIME_TICKS);
  for (const ev of events) {
    if (ev.kind !== 'vehicleDestroyed') continue;
    ev.ruins.forEach((node, i) => {
      next.push({
        hx: node.hx,
        hy: node.hy,
        spawnTick: tick,
        seed: seedFrom(ev.entity * RUIN_SEED_STRIDE + i, tick),
      });
    });
  }
  // The oldest marks sit at the front: `active` predates this frame's pushes.
  if (next.length > MAX_ACTIVE_WRECKS) next.splice(0, next.length - MAX_ACTIVE_WRECKS);
  return next;
}
