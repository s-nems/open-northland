import { entityById, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { ONE, TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../projection/index.js';
import { type BloodHit, bloodLoss, isBloodHit } from './blood-damage.js';
import { frac } from './random.js';

/** Authored presentation, not original behavior. Durations use the 12 Hz simulation clock. */
export const BLOOD_LIFETIME_TICKS = 1200;
export const BLOOD_AIR_TICKS = 11;
export const MAX_BLOOD_MARKS = 4096;
export const MAX_BLOOD_PER_NODE = 4;

export type BloodProfile = 'cut' | 'pierce' | 'blunt';
export interface BloodMark {
  readonly target: number;
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
  readonly seed: number;
  /** Heading in the ground plane, before isometric foreshortening. */
  readonly heading: number;
  readonly profile: BloodProfile;
  readonly fatal: boolean;
  /** Burst strength: a wound taking one quarter of maximum health reaches full intensity. */
  readonly amount: number;
}

/** Events alone create blood; no health polling, bleeding from starvation, or simulation writes. */
export function foldBloodMarks(
  active: readonly BloodMark[],
  events: readonly SimEvent[],
  tick: number,
  snapshot?: WorldSnapshot,
  projectileOrigins?: ReadonlyMap<number, { readonly hx: number; readonly hy: number }>,
): readonly BloodMark[] {
  const expired = active.some((mark) => tick - mark.spawnTick >= BLOOD_LIFETIME_TICKS);
  if (!expired && !events.some(isBloodHit)) return active;
  const next = active.filter((mark) => tick - mark.spawnTick < BLOOD_LIFETIME_TICKS);
  const deaths = new Set<number>();
  const lastHits = new Map<number, BloodHit>();
  for (const event of events) {
    if (event.kind === 'settlerDied') deaths.add(event.entity);
    if (isBloodHit(event)) lastHits.set(event.target, event);
  }
  let ordinal = 0;
  for (const event of events) {
    if (!isBloodHit(event)) continue;
    const source = event.kind === 'combatHit' ? event.attacker : event.projectile;
    const seed =
      (Math.imul(event.target, 2654435761) ^
        Math.imul(source, 2246822519) ^
        Math.imul(ordinal++, 3266489917) ^
        tick) >>>
      0;
    const origin =
      event.kind === 'combatHit' && snapshot !== undefined
        ? (entityById(snapshot, event.attacker)?.components.Position as { x: number; y: number } | undefined)
        : undefined;
    const launch = event.kind === 'projectileHit' ? projectileOrigins?.get(event.projectile) : undefined;
    const from =
      launch !== undefined
        ? { x: launch.hx * TILE_HALF_W, y: (launch.hy * TILE_HALF_H) / 2 }
        : origin === undefined
          ? undefined
          : tileToScreen(origin.x / ONE, origin.y / ONE);
    const dx = from === undefined ? 0 : event.at.hx * TILE_HALF_W - from.x;
    const dy = from === undefined ? 0 : event.at.hy * TILE_HALF_H - from.y * 2;
    next.push({
      ...event.at,
      target: event.target,
      spawnTick: tick,
      amount: Math.min(1, bloodLoss(event) / 0.25),
      seed,
      heading: dx === 0 && dy === 0 ? frac(seed, 0) * Math.PI * 2 : Math.atan2(dy, dx),
      profile:
        event.kind === 'projectileHit' || event.weaponMainType === 2
          ? 'pierce'
          : event.weaponMainType === 1
            ? 'blunt'
            : 'cut',
      fatal: deaths.has(event.target) && lastHits.get(event.target) === event,
    });
  }
  // Keep the newest few impressions at each node. Separate budgets preserve bones and wreckage.
  const perNode = new Map<string, number>();
  const retained: BloodMark[] = [];
  for (let i = next.length - 1; i >= 0 && retained.length < MAX_BLOOD_MARKS; i--) {
    const mark = next[i];
    if (mark === undefined) continue;
    const key = `${mark.hx},${mark.hy}`;
    const count = perNode.get(key) ?? 0;
    if (count >= MAX_BLOOD_PER_NODE) continue;
    perNode.set(key, count + 1);
    retained.push(mark);
  }
  return retained.reverse();
}

export function bloodFade(age: number): number {
  return 1 - smoothUnit((age - BLOOD_LIFETIME_TICKS * 0.6) / (BLOOD_LIFETIME_TICKS * 0.4));
}

export const smoothUnit = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export interface BloodDrop {
  readonly vx: number;
  readonly vy: number;
  readonly rise: number;
  readonly lift: number;
  readonly delay: number;
  readonly flight: number;
  readonly size: number;
}

const GRAVITY = 1.2;
export const GROUND_SQUASH = 0.5;

/** Mint once per visible burst; all trajectory noise stays out of the frame loop. */
export function bloodDrops(mark: BloodMark, bodyRise = 20): readonly BloodDrop[] {
  const strength = Math.sqrt(mark.amount);
  const maximum = (mark.profile === 'blunt' ? 4 : mark.profile === 'pierce' ? 7 : 10) + (mark.fatal ? 3 : 0);
  const count = Math.max(1, Math.round(maximum * strength));
  return Array.from({ length: count }, (_, i) => {
    const offset = i * 8;
    const angle =
      mark.heading + (frac(mark.seed, offset + 1) - 0.5) * (mark.profile === 'pierce' ? 0.9 : 2.4);
    const speed =
      (1.1 + frac(mark.seed, offset + 2) * 3) * (mark.profile === 'blunt' ? 0.6 : 1) * (0.5 + strength * 0.5);
    const rise = bodyRise * (0.9 + frac(mark.seed, offset + 3) * 0.2);
    const lift = 0.2 + frac(mark.seed, offset + 4) * 1.1;
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * GROUND_SQUASH,
      rise,
      lift,
      delay: frac(mark.seed, offset + 5) * 1.2,
      flight: (lift + Math.sqrt(lift * lift + 2 * GRAVITY * rise)) / GRAVITY,
      size: (0.85 + frac(mark.seed, offset + 6) * 0.95) * (0.35 + strength * 0.65),
    };
  });
}

export interface BloodDropPose {
  x: number;
  y: number;
  groundY: number;
  angle: number;
  stretch: number;
  landed: boolean;
  visible: boolean;
}

/** Closed-form ballistics, clamped at contact; the caller reuses its pose scratch each frame. */
export function bloodDroplet(drop: BloodDrop, age: number, out: BloodDropPose): void {
  out.landed = age >= drop.delay + drop.flight;
  const t = out.landed ? drop.flight : Math.max(0, age - drop.delay);
  const fallSpeed = GRAVITY * t - drop.lift;
  out.x = drop.vx * t;
  out.groundY = drop.vy * t;
  out.y = out.groundY - (out.landed ? 0 : Math.max(0, drop.rise + drop.lift * t - 0.5 * GRAVITY * t * t));
  out.angle = Math.atan2(drop.vy + fallSpeed, drop.vx);
  out.stretch = 1 + Math.min(1.1, Math.hypot(drop.vx, drop.vy + fallSpeed) * 0.16);
  out.visible = age >= drop.delay;
}
