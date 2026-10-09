import { clamp01 } from '../math.js';
import { COLLAPSE_LIFETIME_TICKS, collapseRemovalAge, DUST_SETTLE_TICKS } from './collapse.js';
import { frac } from './random.js';

export interface DismantleChip {
  readonly x: number;
  readonly y: number;
  readonly birth: number;
  readonly colour: number;
  readonly seed: number;
}

export const MAX_DISMANTLE_CHIPS = 48;
const CHIPS_PER_LAYER = 12;
const BODY_CLEAR_TICK = collapseRemovalAge(1);
// Settled chips fade before the longer-lived airborne dust.
const CHIP_CLEAR_TICK = BODY_CLEAR_TICK + 40;

/** Sample solid material at different points in the actual removal sequence. The small chips use
 * its palette, not rectangular cutouts of the building. At most twelve origins per layer. */
export function dismantleChips(
  pixels: Uint8ClampedArray,
  removal: Uint8ClampedArray,
  width: number,
  height: number,
  seed: number,
): DismantleChip[] {
  const chips: DismantleChip[] = [];
  for (let i = 0; i < CHIPS_PER_LAYER; i++) {
    const target = 0.05 + (i / CHIPS_PER_LAYER) * 0.85;
    let best: DismantleChip | undefined;
    let distance = Infinity;
    for (let j = 0; j < 40; j++) {
      const x = 1 + Math.floor(frac(seed, i * 103 + j * 3) * Math.max(1, width - 2));
      const y = 1 + Math.floor(frac(seed, i * 103 + j * 3 + 1) * Math.max(1, height - 2));
      const at = (y * width + x) * 4;
      if ((pixels[at + 3] ?? 0) < 220) continue;
      const time = (removal[at] ?? 255) / 255;
      const delta = Math.abs(time - target);
      if (delta >= distance) continue;
      distance = delta;
      best = {
        x,
        y,
        birth: collapseRemovalAge(time),
        colour: ((pixels[at] ?? 0) << 16) | ((pixels[at + 1] ?? 0) << 8) | (pixels[at + 2] ?? 0),
        seed: seed + i * 71,
      };
    }
    if (best !== undefined && !chips.some((chip) => Math.hypot(chip.x - best.x, chip.y - best.y) < 5)) {
      chips.push(best);
    }
  }
  return chips;
}

export interface DismantleChipPose {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
}

/** Gravity, one small impact bounce, then a stationary chip. Pure tick-based artistic motion. */
export function poseDismantleChip(
  out: DismantleChipPose,
  chip: DismantleChip,
  age: number,
  ground: number,
): void {
  const elapsed = Math.max(0, age - chip.birth);
  const fall = Math.sqrt(Math.max(0, ground - chip.y) / 2.8);
  const impactAge = Math.max(0, elapsed - fall);
  const travel = Math.min(elapsed, fall + 2);
  out.x = chip.x + (frac(chip.seed, 1) - 0.5) * 2.6 * travel;
  out.y =
    elapsed < fall
      ? chip.y + 2.8 * elapsed * elapsed
      : ground - Math.sin(Math.min(1, impactAge / 2) * Math.PI) * (1 + frac(chip.seed, 2) * 2);
  out.rotation = frac(chip.seed, 3) * Math.PI + (frac(chip.seed, 4) - 0.5) * travel * 0.7;
  out.alpha = age < chip.birth ? 0 : clamp01((CHIP_CLEAR_TICK - age) / 7);
}

export const MAX_DISMANTLE_DUST = 14;

/** Choose across the removal sequence, keeping the real material coordinates and birth ticks.
 * Irregular sampling avoids a second cloud at every chip and synchronised roof-wide emission. */
export function dismantleDustOrigins(origins: readonly DismantleChip[], seed: number): DismantleChip[] {
  const ordered = [...origins].sort((a, b) => a.birth - b.birth);
  const count = Math.min(ordered.length, MAX_DISMANTLE_DUST - Math.floor(frac(seed, 91) * 5));
  const selected: DismantleChip[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * ordered.length) / count);
    const end = Math.floor(((i + 1) * ordered.length) / count);
    const origin = ordered[start + Math.floor(frac(seed, i + 92) * (end - start))];
    if (origin !== undefined) selected.push(origin);
  }
  return selected;
}

export interface DismantleDustPose {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
}

/** Dust gathers before the body moves, then drifts apart and thins after the structure is gone.
 * Initial swelling is independent of the long dispersal tail, keeping the first breaks covered. */
export function poseDismantleDust(
  out: DismantleDustPose,
  origin: DismantleChip,
  age: number,
  span: number,
): void {
  const seed = origin.seed;
  const birth = frac(seed, 33) * 1.2;
  const elapsed = Math.max(0, age - birth);
  const life = Math.max(24, origin.birth - birth + 27 + frac(seed, 20) * 14);
  const t = clamp01(elapsed / life);
  const travel = 1 - (1 - t) ** 2;
  const dispersion = clamp01((age - BODY_CLEAR_TICK) / DUST_SETTLE_TICKS);
  const radius =
    Math.max(8, span) * (0.45 + frac(seed, 21) * 0.6) * (0.16 + t ** 0.4 * 0.84) * (1 + dispersion * 0.4);
  const swirl = Math.sin(t * Math.PI) * (frac(seed, 22) - 0.5);
  out.x = origin.x + span * ((frac(seed, 23) - 0.5) * (travel * 0.65 + dispersion * 0.7) + swirl * 0.15);
  out.y = origin.y + span * ((frac(seed, 24) - 0.4) * travel * 0.38 + swirl * 0.08 - dispersion * 0.18);
  out.scaleX = (radius / 26) * (0.8 + frac(seed, 25) * 0.55);
  out.scaleY = (radius / 26) * (0.65 + frac(seed, 26) * 0.6);
  out.rotation = frac(seed, 27) * Math.PI * 2 + (frac(seed, 28) - 0.5) * travel * 0.7;
  const fadeIn = smooth(clamp01(elapsed / (1.2 + frac(seed, 29) * 0.9)));
  const fadeStart = BODY_CLEAR_TICK + frac(seed, 34) * 8;
  const fadeDuration = DUST_SETTLE_TICKS * (0.64 + frac(seed, 20) * 0.32);
  const fadeOut = 1 - smooth(clamp01((age - fadeStart) / fadeDuration));
  const tail = smooth(clamp01((COLLAPSE_LIFETIME_TICKS - age) / 24));
  out.alpha = fadeIn * fadeOut * tail * (0.76 + frac(seed, 30) * 0.22);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
