import { type Container, Graphics } from 'pixi.js';
import { frac } from '../../data/effects/blood.js';
import { LIGHTNING_FLASH_SECONDS } from '../../data/weather/climate.js';
import type { LightningStrike, WeatherConditions } from '../../data/weather/types.js';

/**
 * The visible bolt of a near strike: a jagged pixel-wide line from above the screen to the strike's
 * ground point with a few forks, over a faint glow, added onto the picture while the flash lasts. Drawn
 * once per strike, then only faded. An OpenNorthland enhancement; shape constants tuned by eye.
 */

/** Strikes farther than this (0..1) flash the sky without a visible bolt. */
const BOLT_MAX_DISTANCE = 0.65;
/** Main channel segments, sideways jitter per segment (px at the bolt's full length), and forks. */
const BOLT_SEGMENTS = 16;
const BOLT_JITTER_SHARE = 0.07;
const BOLT_FORKS = 3;
const FORK_SEGMENTS = 5;
const FORK_LENGTH_SHARE = 0.22;
/** The bolt starts this far above the screen top, in screen heights. */
const BOLT_TOP = -0.1;
const CORE_WIDTH = 2;
const CORE_COLOUR = 0xf4f8ff;
const GLOW_WIDTH = 10;
const GLOW_COLOUR = 0x8fa6ff;
const GLOW_ALPHA = 0.3;
const HALO_WIDTH = 4;
const HALO_ALPHA = 0.55;
const BOLT_SALT = 0x3b0a57;

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
    const strike = flashingNear(conditions.strikes, gameSeconds);
    if (strike === null || conditions.flash <= 0) {
      this.graphics.visible = false;
      return;
    }
    if (strike.id !== this.drawnId || screenW !== this.drawnW || screenH !== this.drawnH) {
      this.draw(strike, screenW, screenH);
    }
    this.graphics.alpha = Math.min(1, conditions.flash * (1 - strike.distance / BOLT_MAX_DISTANCE + 0.3));
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
    const draw = (k: number): number => frac(BOLT_SALT, strike.id * 64 + k);
    const endX = strike.screenX * screenW;
    const endY = strike.screenY * screenH;
    const startY = BOLT_TOP * screenH;
    const startX = endX + (draw(0) - 0.5) * 0.3 * (endY - startY);
    const length = endY - startY;
    const jitter = BOLT_JITTER_SHARE * length;
    const main: [number, number][] = [];
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const t = i / BOLT_SEGMENTS;
      const edge = i === 0 || i === BOLT_SEGMENTS ? 0 : 1;
      main.push([
        Math.round(startX + (endX - startX) * t + (draw(1 + i) - 0.5) * 2 * jitter * edge),
        Math.round(startY + length * t),
      ]);
    }
    const g = this.graphics;
    g.clear();
    const paths: [number, number][][] = [main];
    for (let f = 0; f < BOLT_FORKS; f++) {
      const from = main[1 + Math.floor(draw(40 + f) * (BOLT_SEGMENTS - 3))];
      if (from === undefined) continue;
      const side = draw(50 + f) < 0.5 ? -1 : 1;
      const fork: [number, number][] = [from];
      let [x, y] = from;
      const step = (FORK_LENGTH_SHARE * length) / FORK_SEGMENTS;
      for (let i = 0; i < FORK_SEGMENTS; i++) {
        x += side * step * (0.4 + draw(55 + f * 8 + i));
        y += step * (0.5 + 0.8 * draw(60 + f * 8 + i));
        fork.push([Math.round(x), Math.round(y)]);
      }
      paths.push(fork);
    }
    for (const [width, colour, alpha] of [
      [GLOW_WIDTH, GLOW_COLOUR, GLOW_ALPHA],
      [HALO_WIDTH, GLOW_COLOUR, HALO_ALPHA],
      [CORE_WIDTH, CORE_COLOUR, 1],
    ] as const) {
      paths.forEach((path, index) => {
        const first = path[0];
        if (first === undefined) return;
        g.moveTo(first[0], first[1]);
        for (const [x, y] of path.slice(1)) g.lineTo(x, y);
        // Forks are thinner and fainter than the main channel.
        const share = index === 0 ? 1 : 0.5;
        g.stroke({
          width: Math.max(1, width * share),
          color: colour,
          alpha: alpha * (index === 0 ? 1 : 0.7),
        });
      });
    }
  }
}

/** The newest near strike whose flash is still running. */
function flashingNear(strikes: readonly LightningStrike[], gameSeconds: number): LightningStrike | null {
  for (let i = strikes.length - 1; i >= 0; i--) {
    const strike = strikes[i];
    if (strike === undefined) continue;
    const age = gameSeconds - strike.atSeconds;
    if (age >= 0 && age <= LIGHTNING_FLASH_SECONDS && strike.distance <= BOLT_MAX_DISTANCE) return strike;
  }
  return null;
}
