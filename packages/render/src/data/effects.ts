import type { SimEvent } from '@open-northland/sim';

/**
 * The pure half of the combat-feedback layer: the sim's one-shot `combatHit` / `projectileHit` / `settlerDied`
 * events (each carrying a half-cell node) fold into a decaying list of render-only ground marks — blood where a
 * blow lands, bones where a unit falls. Decay is measured in sim ticks, not wall-clock, so a `?shot` capture and
 * a paused game reproduce exactly.
 *
 * The original's HIT particle (`logicdefines.inc` PARTICEL_EFFECT HIT 1) is unbound here, so the blood burst is a
 * named procedural approximation: droplets that spray from the wound and fall under gravity ({@link bloodDroplet}
 * owns the motion). Bones draw the decoded cadaver sprite (skeleton_falling → cadaver_skeleton) when the app
 * supplies it, else a procedural pile. The shapes are the GPU layer's; this module owns the decay, the droplet
 * motion, and the event→mark fold.
 */

/** A ground mark: a blood splatter (a landed blow) or a bone pile (a death). */
export type CombatEffectKind = 'blood' | 'bones';

/** One transient ground mark, positioned at a half-cell node and decaying from its spawn tick. */
export interface CombatEffect {
  readonly kind: CombatEffectKind;
  /** Half-cell node x (the event's `at.x`) — projected via `halfCellToScreen`, lifted by the terrain. */
  readonly hx: number;
  /** Half-cell node y (the event's `at.y`). */
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

/** A deterministic float in [0, 1) from a mark's seed and a droplet/shaft index — no `Math.random`, so a
 *  `?shot` capture reproduces the exact splatter. */
export function frac(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

// --- Blood-spurt motion (render-only; world px, render-ticks). A named, eye-calibrated approximation: droplets
//     spray from the wound at chest height and fall to the feet under gravity, then pool and fade. ---

/** How far up a blood spurt sits from the victim's feet node — the wound height it sprays from and falls back
 *  down to (a viking body is ~32 world px tall; ~40% up puts the wound on the chest). The GPU layer lifts the
 *  blood node here; the droplets then fall exactly this far to pool at the feet. */
export const BLOOD_RISE = 13;
/** Render-ticks a droplet takes to fall from the wound to the feet — the gravity below is tuned to it. */
const BLOOD_FALL_TICKS = 8;
/** Downward acceleration (world px / render-tick²), set so a droplet released at rest falls {@link BLOOD_RISE}
 *  in exactly {@link BLOOD_FALL_TICKS} ticks (`y = ½·g·t²` ⇒ `g = 2·rise / fallTicks²`) — a closed-form landing
 *  time with no per-droplet `sqrt`. */
const BLOOD_GRAVITY = (2 * BLOOD_RISE) / (BLOOD_FALL_TICKS * BLOOD_FALL_TICKS);
/** Initial spread of the droplets around the wound point (world px) — a small fan, not one blob. */
const BLOOD_SPRAY = 3;
/** Max horizontal drift speed as a droplet falls (world px / render-tick) — a slight sideways run. */
const BLOOD_DRIFT = 0.9;
/** Max per-droplet start delay (render-ticks) — staggers the drips so it reads as running, not a single drop. */
const BLOOD_DRIP_STAGGER = 5;
/** Vertical elongation per unit fall-speed, and its cap — a fast drop stretches into a streak. */
const BLOOD_STREAK = 0.35;
const BLOOD_MAX_STREAK = 2.3;
/** A landed droplet's stretch — flattened vertically and spread horizontally into a small pool. */
const BLOOD_POOL_STRETCH_Y = 0.5;
const BLOOD_POOL_STRETCH_X = 1.6;

/** A blood droplet's animated transform at `age` render-ticks after the hit, in the blood node's local
 *  space (origin = the wound, y grows downward to the feet at {@link BLOOD_RISE}). */
interface BloodDroplet {
  readonly x: number;
  readonly y: number;
  /** True once the droplet has reached the ground and become part of the pool. */
  readonly landed: boolean;
  /** Vertical scale: a falling drop is a streak (> 1), a pooled one is flat (< 1). */
  readonly stretchY: number;
  /** Horizontal scale: a pooled drop spreads (> 1), a falling one stays thin (≤ 1). */
  readonly stretchX: number;
}

/**
 * Where droplet `i` of a blood splatter is at `age` render-ticks after the hit: it starts in a small seeded
 * fan around the wound, falls straight down under {@link BLOOD_GRAVITY} with a slight horizontal drift, and
 * settles into a flattened pool at the feet ({@link BLOOD_RISE} below the wound) after a per-droplet delay.
 * Motion is a closed form (no integration state), so it's correct at any render `age`, whole or fractional
 * (the layer feeds it interpolated render time for smooth falling).
 */
export function bloodDroplet(seed: number, i: number, age: number): BloodDroplet {
  // Three consecutive seeded values per droplet (stride 3): initial spread, drift speed, drip delay. The
  // drawing layer draws each droplet's radius from `frac(seed, i + BLOOD_RADIUS_SEED)`, an index range kept
  // disjoint from this `i * 3 + {0,1,2}` band.
  const x0 = (frac(seed, i * 3) - 0.5) * 2 * BLOOD_SPRAY;
  const vx = (frac(seed, i * 3 + 1) - 0.5) * 2 * BLOOD_DRIFT;
  const delay = frac(seed, i * 3 + 2) * BLOOD_DRIP_STAGGER;
  const t = Math.max(0, age - delay);
  const landed = t >= BLOOD_FALL_TICKS;
  const tc = landed ? BLOOD_FALL_TICKS : t; // freeze motion at the landing frame
  const speed = BLOOD_GRAVITY * tc;
  return {
    x: x0 + vx * tc,
    y: 0.5 * BLOOD_GRAVITY * tc * tc,
    landed,
    stretchY: landed ? BLOOD_POOL_STRETCH_Y : Math.min(1 + speed * BLOOD_STREAK, BLOOD_MAX_STREAK),
    stretchX: landed ? BLOOD_POOL_STRETCH_X : 1 / (1 + speed * BLOOD_STREAK * 0.4),
  };
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
