import { type Container, Graphics } from 'pixi.js';
import { frac } from '../../data/effects/blood.js';
import { LIGHTNING_FLASH_SECONDS } from '../../data/weather/climate.js';
import type { LightningStrike, WeatherConditions } from '../../data/weather/types.js';

/**
 * The visible bolt of a near strike: a channel from above the screen to the strike's ground point, built
 * by midpoint displacement, with thinner branches forking off it and branches of branches, a bright core
 * over a soft cool glow, added onto the picture while the flash lasts. Most strikes are far and only
 * light the sky. Drawn once per strike, then only faded. An OpenNorthland enhancement; shape constants
 * tuned by eye.
 */

/** Strikes farther than this (0..1) flash the sky without a visible bolt: about one strike in ten. */
const BOLT_MAX_DISTANCE = 0.3;
/** Halvings of the main channel (2^levels segments), and its first sideways displacement as a share of
 *  its length; each halving keeps this share of the previous displacement. */
const MAIN_LEVELS = 7;
const MAIN_DISPLACEMENT_SHARE = 0.18;
const ROUGHNESS = 0.55;
/** Branches fork at halving levels in this range with this chance per new midpoint and generation, and
 *  run this share of their parent's length at this angle (radians) off its heading; each level deeper
 *  halves the length. */
const BRANCH_LEVELS = { from: 1, to: 4 } as const;
const BRANCH_CHANCE: readonly number[] = [0.2, 0.16];
const BRANCH_LENGTH_SHARE = { min: 0.25, max: 0.6 } as const;
const BRANCH_ANGLE = { min: 0.35, max: 1 } as const;
/** A branch has this many fewer halvings than its parent. */
const BRANCH_LEVEL_DROP = 2;
/** A branch fades out along its length over this many strokes. */
const BRANCH_FADE_STEPS = 4;
/** The bolt starts this far above the screen top, in screen heights, and leans at most this share of
 *  its height sideways. */
const BOLT_TOP = -0.1;
const BOLT_LEAN = 0.25;
/** Stroke layers from the widest glow to the core: width px per generation, colour, alpha. */
const STROKES = [
  { widths: [8, 4, 3], colour: 0x6f86ff, alpha: 0.08 },
  { widths: [3, 1.8, 1.4], colour: 0xa9bcff, alpha: 0.25 },
  { widths: [1.3, 0.9, 0.8], colour: 0xf2f6ff, alpha: 0.9 },
] as const;
/** Alpha of each branch generation relative to the main channel. */
const GENERATION_ALPHA: readonly number[] = [1, 0.6, 0.4];
/** The bolt shows brighter than the flash that carries it; at the visible limit it keeps this share. */
const BOLT_FLASH_GAIN = 1.3;
const BOLT_FAR_SHARE = 0.5;
const BOLT_SALT = 0x3b0a57;
const BOLT_ID_MIX = 0x2c1b3c6d;

type Point = readonly [number, number];

interface BoltPath {
  readonly points: readonly Point[];
  readonly generation: number;
}

/** Midpoint displacement of `from`..`to` over `levels` halvings, pushing the path and its branches. */
function growChannel(
  from: Point,
  to: Point,
  displacement: number,
  levels: number,
  generation: number,
  draw: () => number,
  out: BoltPath[],
): void {
  let points: Point[] = [from, to];
  let offset = displacement;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const branchChance = BRANCH_CHANCE[generation] ?? 0;
  for (let level = 0; level < levels; level++) {
    const next: Point[] = [from];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] ?? from;
      const b = points[i] ?? to;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const span = Math.hypot(dx, dy) || 1;
      const shift = (draw() - 0.5) * 2 * offset;
      const mid: Point = [(a[0] + b[0]) / 2 - (dy / span) * shift, (a[1] + b[1]) / 2 + (dx / span) * shift];
      next.push(mid, b);
      const forks = level >= BRANCH_LEVELS.from && level <= BRANCH_LEVELS.to && draw() < branchChance;
      if (!forks) continue;
      const side = draw() < 0.5 ? -1 : 1;
      const angle =
        Math.atan2(dy, dx) + side * (BRANCH_ANGLE.min + draw() * (BRANCH_ANGLE.max - BRANCH_ANGLE.min));
      const share = BRANCH_LENGTH_SHARE.min + draw() * (BRANCH_LENGTH_SHARE.max - BRANCH_LENGTH_SHARE.min);
      const reach = (length * share) / 2 ** (level - BRANCH_LEVELS.from);
      const end: Point = [mid[0] + Math.cos(angle) * reach, mid[1] + Math.sin(angle) * reach];
      const branchLevels = Math.max(1, levels - BRANCH_LEVEL_DROP);
      growChannel(mid, end, reach * MAIN_DISPLACEMENT_SHARE, branchLevels, generation + 1, draw, out);
    }
    points = next;
    offset *= ROUGHNESS;
  }
  out.push({ points, generation });
}

/** The main channel and its branches for `strike` on a `screenW` by `screenH` screen; pure in its input. */
export function boltPaths(strike: LightningStrike, screenW: number, screenH: number): BoltPath[] {
  const seed = BOLT_SALT ^ Math.imul(strike.id, BOLT_ID_MIX);
  let k = 0;
  const draw = (): number => frac(seed, k++);
  const endX = strike.screenX * screenW;
  const endY = strike.screenY * screenH;
  const startY = BOLT_TOP * screenH;
  const length = endY - startY;
  const startX = endX + (draw() - 0.5) * 2 * BOLT_LEAN * length;
  const paths: BoltPath[] = [];
  growChannel([startX, startY], [endX, endY], MAIN_DISPLACEMENT_SHARE * length, MAIN_LEVELS, 0, draw, paths);
  return paths;
}

export class LightningBolt {
  private readonly graphics = new Graphics();
  private drawnId: number | null = null;
  private drawnW = 0;
  private drawnH = 0;

  constructor(parent: Container) {
    this.graphics.blendMode = 'add';
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  update(conditions: WeatherConditions, gameSeconds: number, screenW: number, screenH: number): void {
    const strike = flashingStrike(conditions.strikes, gameSeconds, BOLT_MAX_DISTANCE);
    if (strike === null || conditions.flash <= 0) {
      this.graphics.visible = false;
      return;
    }
    if (strike.id !== this.drawnId || screenW !== this.drawnW || screenH !== this.drawnH) {
      this.draw(strike, screenW, screenH);
    }
    const nearness = 1 - strike.distance / BOLT_MAX_DISTANCE;
    this.graphics.alpha = Math.min(
      1,
      conditions.flash * BOLT_FLASH_GAIN * (BOLT_FAR_SHARE + (1 - BOLT_FAR_SHARE) * nearness),
    );
    this.graphics.visible = true;
  }

  hide(): void {
    this.graphics.visible = false;
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private draw(strike: LightningStrike, screenW: number, screenH: number): void {
    this.drawnId = strike.id;
    this.drawnW = screenW;
    this.drawnH = screenH;
    const paths = boltPaths(strike, screenW, screenH);
    const g = this.graphics;
    g.clear();
    for (const layer of STROKES) {
      for (const path of paths) {
        const width = layer.widths[path.generation] ?? layer.widths[layer.widths.length - 1] ?? 1;
        const alpha = layer.alpha * (GENERATION_ALPHA[path.generation] ?? 0);
        // The main channel is drawn whole; a branch in steps that fade towards its tip.
        const steps = path.generation === 0 ? 1 : BRANCH_FADE_STEPS;
        const perStep = Math.ceil((path.points.length - 1) / steps);
        for (let s = 0; s < steps; s++) {
          const chunk = path.points.slice(s * perStep, (s + 1) * perStep + 1);
          const first = chunk[0];
          if (first === undefined || chunk.length < 2) continue;
          g.moveTo(first[0], first[1]);
          for (let i = 1; i < chunk.length; i++) {
            const point = chunk[i];
            if (point !== undefined) g.lineTo(point[0], point[1]);
          }
          g.stroke({
            width,
            color: layer.colour,
            alpha: alpha * (1 - s / steps),
            join: 'round',
            cap: 'round',
          });
        }
      }
    }
  }
}

/** The newest strike within `maxDistance` whose flash is still running. */
export function flashingStrike(
  strikes: readonly LightningStrike[],
  gameSeconds: number,
  maxDistance = 1,
): LightningStrike | null {
  for (let i = strikes.length - 1; i >= 0; i--) {
    const strike = strikes[i];
    if (strike === undefined) continue;
    const age = gameSeconds - strike.atSeconds;
    if (age >= 0 && age <= LIGHTNING_FLASH_SECONDS && strike.distance <= maxDistance) return strike;
  }
  return null;
}
