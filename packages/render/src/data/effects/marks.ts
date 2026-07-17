import type { SimEvent } from '@open-northland/sim';

/**
 * The combat-mark lifecycle: the event→mark fold and the per-kind decay the layer fades marks by.
 * Decay is measured in sim ticks, not wall-clock, so a `?shot` capture and a paused game reproduce
 * exactly. The droplet motion of a blood mark lives in {@link import('./blood.js')}.
 */

/** A ground mark: a blood splatter (a landed blow) or a bone pile (a death). */
export type CombatEffectKind = 'blood' | 'bones';

/** One transient ground mark, positioned at a half-cell node and decaying from its spawn tick. */
export interface CombatEffect {
  readonly kind: CombatEffectKind;
  /** Half-cell node x (the event's `at.hx`) — projected via `halfCellToScreen`, lifted by the terrain. */
  readonly hx: number;
  /** Half-cell node y (the event's `at.hy`). */
  readonly hy: number;
  /** The sim tick it was spawned on — decay is `tick - spawnTick` against the per-kind lifetime. */
  readonly spawnTick: number;
  /** A per-mark integer, seeded from the source entity + tick, driving splatter jitter / bone orientation
   *  without `Math.random`. Doubles as the retained-pool key. */
  readonly seed: number;
}

/**
 * How long a blood splatter lingers before it has fully faded, in sim ticks — a short-lived hit marker, so a busy
 * fight doesn't carpet the ground in red. Approximated (the original's HIT particle lifetime is unreadable).
 */
export const BLOOD_LIFETIME_TICKS = 60;
/**
 * How long a bone pile lingers before it has fully faded, in sim ticks — a long-lived battlefield mark that still
 * fades so a long war doesn't accumulate unbounded marks. Approximated (the original's cadaver decay time is
 * unreadable).
 */
export const BONES_LIFETIME_TICKS = 1800;
/**
 * The fraction of a mark's lifetime it holds full opacity before fading to nothing over the remaining tail.
 */
const BLOOD_FADE_HOLD = 0.35;
const BONES_FADE_HOLD = 0.8;
/**
 * The most marks kept alive at once, bounding the per-frame cull pass independently of total casualties (golden
 * rule 7). When exceeded the oldest marks are dropped first; blood self-expires fast, so the evicted ones are
 * usually old bones.
 */
export const MAX_ACTIVE_EFFECTS = 400;

/** The lifetime (ticks) of a mark of `kind`. */
function effectLifetime(kind: CombatEffectKind): number {
  return kind === 'blood' ? BLOOD_LIFETIME_TICKS : BONES_LIFETIME_TICKS;
}

/**
 * A mark's opacity at `tick`: full through its hold fraction, then linear to 0 at the end of its lifetime;
 * 0 once expired (the caller then drops/hides it). Render-only float — never a sim decision.
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

/** A stable per-mark key for the retained GPU pool (a mark's kind + spawn tick + seed are unique per event). */
export function effectKey(effect: CombatEffect): string {
  return `${effect.kind}:${effect.spawnTick}:${effect.seed}`;
}

/** Mix a source entity id and the tick into a 32-bit seed — distinct per (source, tick) so two simultaneous
 *  marks jitter differently and the same source jitters differently across ticks. */
function seedFrom(sourceId: number, tick: number): number {
  return (Math.imul(sourceId, 2654435761) + Math.imul(tick, 40503)) >>> 0;
}

/**
 * Fold this frame's sim events into the live mark list: drop expired marks, then append a blood splatter for each
 * landed blow (`combatHit` melee / `projectileHit` ranged) and a bone pile for each death carrying a position
 * (`settlerDied.at`). A miss emits no hit event, so it leaves no blood. The list is capped at
 * {@link MAX_ACTIVE_EFFECTS} (oldest-first drop). Returns a new array; pure over its inputs.
 */
export function foldCombatEffects(
  active: readonly CombatEffect[],
  events: readonly SimEvent[],
  tick: number,
): CombatEffect[] {
  const next = active.filter((e) => tick - e.spawnTick < effectLifetime(e.kind));
  for (const ev of events) {
    if (ev.kind === 'combatHit' || ev.kind === 'projectileHit') {
      next.push({
        kind: 'blood',
        hx: ev.at.hx,
        hy: ev.at.hy,
        spawnTick: tick,
        seed: seedFrom(ev.target, tick),
      });
    } else if (ev.kind === 'settlerDied' && ev.at !== undefined) {
      next.push({
        kind: 'bones',
        hx: ev.at.hx,
        hy: ev.at.hy,
        spawnTick: tick,
        seed: seedFrom(ev.entity, tick),
      });
    }
  }
  // Bound the list: drop the oldest marks (front of the array — `active` is older than this frame's pushes).
  if (next.length > MAX_ACTIVE_EFFECTS) next.splice(0, next.length - MAX_ACTIVE_EFFECTS);
  return next;
}
