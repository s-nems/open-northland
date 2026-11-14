import { describe, expect, it } from 'vitest';
import {
  WET_STEP_FRAME_H,
  WET_STEP_FRAME_W,
  WET_STEP_FRAMES,
  WET_STEP_LIFE_TICKS,
  wetStepFrame,
  wetStepStrength,
  wetStepStrip,
} from '../../../src/data/effects/index.js';

const RGBA = 4;

/** The opacity bytes of one frame of the strip, row-major. */
function alphaOf(strip: Uint8Array, frame: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < WET_STEP_FRAME_H; y++)
    for (let x = 0; x < WET_STEP_FRAME_W; x++)
      out.push(
        strip[(y * WET_STEP_FRAME_W * WET_STEP_FRAMES + frame * WET_STEP_FRAME_W + x) * RGBA + 3] ?? 0,
      );
  return out;
}

describe('wet step', () => {
  it('splashes only on wet enough ground, harder the wetter it is', () => {
    expect(wetStepStrength(0)).toBe(0);
    expect(wetStepStrength(1)).toBe(1);
    const levels = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(wetStepStrength);
    const splashing = levels.filter((s) => s > 0);
    expect(splashing.length).toBeGreaterThan(0);
    expect(splashing[0]).toBeLessThan(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1] ?? 0);
  });

  it('plays every frame once over its life', () => {
    expect(wetStepFrame(-0.1)).toBe(-1);
    expect(wetStepFrame(0)).toBe(0);
    expect(wetStepFrame(WET_STEP_LIFE_TICKS - 0.01)).toBe(WET_STEP_FRAMES - 1);
    expect(wetStepFrame(WET_STEP_LIFE_TICKS)).toBe(-1);
  });

  it('paints a splash that leaps over the foot, spreads and fades, inside its frame', () => {
    const strip = wetStepStrip();
    const rowsOf = (alpha: number[]) =>
      alpha.flatMap((a, i) => (a > 0 ? [Math.floor(i / WET_STEP_FRAME_W)] : []));
    const columnsOf = (alpha: number[]) => alpha.flatMap((a, i) => (a > 0 ? [i % WET_STEP_FRAME_W] : []));
    const first = alphaOf(strip, 0);
    const early = alphaOf(strip, 3);
    const last = alphaOf(strip, WET_STEP_FRAMES - 1);
    // Droplets in flight rise above the rings that outlast them; the rings spread and fade.
    expect(Math.min(...rowsOf(early))).toBeLessThan(Math.min(...rowsOf(last)));
    const width = (alpha: number[]) => Math.max(...columnsOf(alpha)) - Math.min(...columnsOf(alpha));
    expect(width(last)).toBeGreaterThan(width(first));
    expect(Math.max(...last)).toBeLessThan(Math.max(...first));
    // A clear border all round, so a neighbouring frame never bleeds in.
    for (let frame = 0; frame < WET_STEP_FRAMES; frame++) {
      const alpha = alphaOf(strip, frame);
      expect(Math.min(...columnsOf(alpha))).toBeGreaterThan(0);
      expect(Math.max(...columnsOf(alpha))).toBeLessThan(WET_STEP_FRAME_W - 1);
      expect(Math.max(...rowsOf(alpha))).toBeLessThan(WET_STEP_FRAME_H - 1);
      expect(Math.min(...rowsOf(alpha))).toBeGreaterThan(0);
    }
  });
});
