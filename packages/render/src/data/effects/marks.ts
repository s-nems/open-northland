import type { SimEvent } from '@open-northland/sim';

/**
 * The combat-mark lifecycle: the event → mark fold and the per-kind decay the layer fades marks by.
 * Ages are measured in sim ticks, not wall-clock, so a paused game and a `?shot` capture reproduce
 * exactly.
 */

export type CombatEffectKind = 'blood' | 'bones' | 'wreck';

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
 * How long a blood splatter lingers before it has fully faded, in sim ticks. Approximated - the
 * original's HIT particle (`logicdefines.inc` PARTICEL_EFFECT HIT 1) has no readable lifetime.
 */
export const BLOOD_LIFETIME_TICKS = 60;
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
const BLOOD_FADE_HOLD = 0.35;
const BONES_FADE_HOLD = 0.8;
/** The most marks kept alive at once, bounding the per-frame pass; oldest dropped first. */
export const MAX_ACTIVE_EFFECTS = 400;

function effectLifetime(kind: CombatEffectKind): number {
  switch (kind) {
    case 'blood':
      return BLOOD_LIFETIME_TICKS;
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
  const hold = life * (effect.kind === 'blood' ? BLOOD_FADE_HOLD : BONES_FADE_HOLD);
  if (age <= hold) return 1;
  return 1 - (age - hold) / (life - hold);
}

/** A stable per-mark key for the retained GPU pool - unique per event. */
export function effectKey(effect: CombatEffect): string {
  return `${effect.kind}:${effect.spawnTick}:${effect.seed}`;
}

/** Mix a source entity id and the tick into a 32-bit seed, distinct per (source, tick). */
function seedFrom(sourceId: number, tick: number): number {
  return (Math.imul(sourceId, 2654435761) + Math.imul(tick, 40503)) >>> 0;
}

/** Ruin nodes beyond this stride into one event share a seed's neighbour; a footprint is a hex disc of
 *  radius at most 2 (19 nodes), so it never reaches it. */
const RUIN_SEED_STRIDE = 64;

/**
 * Fold this frame's combat events into the live mark list: a blood splatter per landed blow, a bone
 * pile per human death (an animal death leaves no bones - see the event's `animal` doc for the source
 * basis), a debris mark per ruin node of a wrecked vehicle (the sim drew the nodes; a scripted removal
 * and a ship carry none), expired marks dropped and the list capped at {@link MAX_ACTIVE_EFFECTS}.
 */
export function foldCombatEffects(
  active: readonly CombatEffect[],
  events: readonly SimEvent[],
  tick: number,
): CombatEffect[] {
  const next = active.filter((e) => tick - e.spawnTick < effectLifetime(e.kind));
  for (const ev of events) {
    if (ev.kind === 'combatHit' || ev.kind === 'projectileHit') {
      if (ev.structure === true) continue; // a besieged wall doesn't bleed - impact SFX only, no blood
      next.push({
        kind: 'blood',
        hx: ev.at.hx,
        hy: ev.at.hy,
        spawnTick: tick,
        seed: seedFrom(ev.target, tick),
      });
    } else if (ev.kind === 'settlerDied' && ev.at !== undefined && ev.animal !== true) {
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
