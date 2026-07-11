import type { SimEvent } from '@vinland/sim';

/**
 * The pure half of the combat-feedback layer — the transient ground marks a battle leaves behind: a
 * BLOOD splatter where a blow lands, and BONES where a unit falls. These are RENDER-ONLY (no sim state,
 * no golden churn): the sim emits `combatHit` / `projectileHit` (a wound) and `settlerDied` (a death) as
 * one-shot events carrying a HALF-CELL NODE, and this fold turns them into a decaying list the GPU layer
 * draws. Decay is measured in SIM TICKS (the event's tick), not wall-clock, so a `?shot` capture and a
 * paused game both reproduce exactly — no float time enters the "what is on the ground" decision.
 *
 * The original leaves the HIT particle (`logicdefines.inc` PARTICEL_EFFECT HIT 1) and a cadaver landscape
 * object (skeleton_falling → cadaver_skeleton) on the field; both assets are unbound here, so the blood
 * burst and the bone pile are NAMED procedural APPROXIMATIONS (a small red splatter, a simple bone mark) —
 * a stand-in like the projectile arrow marker, to be swapped for the extracted cadaver gfx later. The
 * SHAPES are the GPU layer's; this module owns the vocabulary, the decay, and the event→mark fold.
 */

/** A ground mark: a blood splatter (a landed blow) or a bone pile (a death). */
export type CombatEffectKind = 'blood' | 'bones';

/** One transient ground mark, positioned at a half-cell NODE and decaying from its spawn tick. */
export interface CombatEffect {
  readonly kind: CombatEffectKind;
  /** Half-cell node x (the event's `at.x`) — projected via `halfCellToScreen`, lifted by the terrain. */
  readonly hx: number;
  /** Half-cell node y (the event's `at.y`). */
  readonly hy: number;
  /** The sim tick it was spawned on — decay is `tick - spawnTick` against the per-kind lifetime. */
  readonly spawnTick: number;
  /** A per-mark integer, seeded from the source entity + tick, driving deterministic splatter jitter /
   *  bone orientation so a screenshot reproduces (no `Math.random`). Doubles as the retained-pool key. */
  readonly seed: number;
}

/**
 * How long a blood splatter lingers before it has fully faded, in SIM TICKS. A hit MARKER — it flashes to
 * confirm the blow landed, then dries away over a second or two. APPROXIMATED (the original's HIT particle
 * lifetime is unreadable); calibration-pending, but a short-lived cue by design so a busy fight doesn't
 * carpet the ground in red.
 */
export const BLOOD_LIFETIME_TICKS = 60;
/**
 * How long a bone pile lingers before it has fully faded, in SIM TICKS. The dead leave bones ON THE GROUND
 * (the user's ask) — a long-lived battlefield mark, not a flash — so this is much longer than blood, then
 * fades out so a century-long war doesn't accumulate unbounded marks. APPROXIMATED / calibration-pending
 * (the original's cadaver decay time is unreadable).
 */
export const BONES_LIFETIME_TICKS = 1800;
/**
 * The fraction of a mark's lifetime it holds FULL opacity before it begins fading to nothing over the
 * remaining tail. Blood dries gradually (short hold); bones sit for most of their life then crumble.
 */
const BLOOD_FADE_HOLD = 0.35;
const BONES_FADE_HOLD = 0.8;
/**
 * The most marks kept alive at once — a hard cap so a huge battle's ground-litter cost (the per-frame cull
 * pass) stays bounded (golden rule 7), independent of total casualties. When exceeded, the OLDEST marks are
 * dropped first (blood ages out fastest, so it's usually blood). The GPU draw is already screen-culled; this
 * bounds the CPU list itself.
 */
export const MAX_ACTIVE_EFFECTS = 400;

/** The lifetime (ticks) of a mark of `kind`. */
export function effectLifetime(kind: CombatEffectKind): number {
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
 *  marks jitter differently and the same source jitters differently across ticks. Pure integer hash. */
function seedFrom(sourceId: number, tick: number): number {
  return (Math.imul(sourceId, 2654435761) + Math.imul(tick, 40503)) >>> 0;
}

/**
 * Fold this frame's sim events into the live mark list: drop expired marks (age past their lifetime), then
 * append a BLOOD splatter for each landed blow (`combatHit` melee / `projectileHit` ranged) and a BONE pile
 * for each death carrying a position (`settlerDied.at`). A miss emits no hit event, so it leaves no blood —
 * the "attack with no target draws no blood" rule falls straight out of the sim's hit-resolution guard. The
 * list is capped at {@link MAX_ACTIVE_EFFECTS} (oldest-first drop). Returns a NEW array; pure over its inputs.
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
        hx: ev.at.x,
        hy: ev.at.y,
        spawnTick: tick,
        seed: seedFrom(ev.target, tick),
      });
    } else if (ev.kind === 'settlerDied' && ev.at !== undefined) {
      next.push({
        kind: 'bones',
        hx: ev.at.x,
        hy: ev.at.y,
        spawnTick: tick,
        seed: seedFrom(ev.entity, tick),
      });
    }
  }
  // Bound the list: drop the oldest marks (front of the array — `active` is older than this frame's pushes).
  if (next.length > MAX_ACTIVE_EFFECTS) next.splice(0, next.length - MAX_ACTIVE_EFFECTS);
  return next;
}
