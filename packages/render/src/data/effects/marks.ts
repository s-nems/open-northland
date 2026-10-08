import type { SimEvent } from '@open-northland/sim';

/**
 * The combat-mark lifecycle: the event → mark fold and the per-kind decay the layer fades marks by.
 * Ages are measured in sim ticks, not wall-clock, so a paused game and a `?shot` capture reproduce
 * exactly.
 */

export type CombatEffectKind = 'bones' | 'wreck';

export interface CombatEffect {
  readonly kind: CombatEffectKind;
  /** Half-cell node coordinates. */
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
  /** Per-mark jitter seed from the source entity and tick - deterministic, no `Math.random`. */
  readonly seed: number;
}

/**
 * How long a bone pile lingers before it has fully faded, in sim ticks. Approximated: the original's
 * `cadaver_skeleton` auto-decays after a readable param of 100 (`landscapetypes.ini` transition 13),
 * but that param's unit is not readable.
 */
export const BONES_LIFETIME_TICKS = 1800;
/**
 * How long a wreck's debris lingers, in sim ticks. Approximation: the original scatters a ruin
 * landscape over the footprint, whose type and decay are not identified (docs/formats/VEHICLES.md), so
 * the debris shares the bone pile's tail.
 */
export const WRECK_LIFETIME_TICKS = BONES_LIFETIME_TICKS;
/** The fraction of a mark's lifetime it holds full opacity before fading over the remaining tail. */
const BONES_FADE_HOLD = 0.8;
/** The most marks kept alive at once, bounding the per-frame pass; oldest dropped first. */
export const MAX_ACTIVE_EFFECTS = 400;

function effectLifetime(kind: CombatEffectKind): number {
  switch (kind) {
    case 'bones':
      return BONES_LIFETIME_TICKS;
    case 'wreck':
      return WRECK_LIFETIME_TICKS;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return BONES_LIFETIME_TICKS;
    }
  }
}

/**
 * A mark's opacity at `tick`: full through its hold fraction, then linear to 0 at the end of its
 * lifetime, and 0 once expired.
 */
export function effectAlpha(effect: CombatEffect, tick: number): number {
  const age = tick - effect.spawnTick;
  const life = effectLifetime(effect.kind);
  if (age <= 0) return 1;
  if (age >= life) return 0;
  const hold = life * BONES_FADE_HOLD;
  if (age <= hold) return 1;
  return 1 - (age - hold) / (life - hold);
}

/** Whether `ev` adds a mark in {@link foldCombatEffects}. */
function raisesMark(ev: SimEvent): boolean {
  if (ev.kind === 'settlerDied') return ev.at !== undefined && ev.animal !== true;
  return ev.kind === 'vehicleDestroyed' && ev.ruins.length > 0;
}

/** Mix a source entity id and the tick into a 32-bit seed, distinct per (source, tick). */
function seedFrom(sourceId: number, tick: number): number {
  return (Math.imul(sourceId, 2654435761) + Math.imul(tick, 40503)) >>> 0;
}

/** Ruin nodes beyond this stride into one event share a seed's neighbour; a footprint is a hex disc of
 *  radius at most 2 (19 nodes), so it never reaches it. */
const RUIN_SEED_STRIDE = 64;

/**
 * A bone pile per positioned human death, debris per vehicle ruin node, and a capped expiry queue.
 * Animals leave no bones (the event documents the source basis); ships carry no ruin nodes.
 */
export function foldCombatEffects(
  active: readonly CombatEffect[],
  events: readonly SimEvent[],
  tick: number,
): readonly CombatEffect[] {
  // Called every frame: a frame that raised and expired nothing keeps the list it was handed.
  const expired = active.some((e) => tick - e.spawnTick >= effectLifetime(e.kind));
  if (!expired && !events.some(raisesMark)) return active;
  const next = active.filter((e) => tick - e.spawnTick < effectLifetime(e.kind));
  for (const ev of events) {
    if (ev.kind === 'settlerDied' && ev.at !== undefined && ev.animal !== true) {
      next.push({
        kind: 'bones',
        hx: ev.at.hx,
        hy: ev.at.hy,
        spawnTick: tick,
        seed: seedFrom(ev.entity, tick),
      });
    } else if (ev.kind === 'vehicleDestroyed') {
      ev.ruins.forEach((node, i) => {
        next.push({
          kind: 'wreck',
          hx: node.hx,
          hy: node.hy,
          spawnTick: tick,
          seed: seedFrom(ev.entity * RUIN_SEED_STRIDE + i, tick),
        });
      });
    }
  }
  // The oldest marks sit at the front: `active` predates this frame's pushes.
  if (next.length > MAX_ACTIVE_EFFECTS) next.splice(0, next.length - MAX_ACTIVE_EFFECTS);
  return next;
}
