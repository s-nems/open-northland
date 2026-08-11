import { Container, type Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { createReusableBaker, oversampleFor } from '../src/gpu/supersample.js';

/**
 * The bake targets double the device coverage so the linear downscale ratio stays in (1, 2]: a ratio near
 * 1 leaves nearest-hard palette edges, and above 2 undersamples the GPU's 2×2 linear tap.
 */
describe('oversampleFor - supersample sizing policy', () => {
  it('doubles the device coverage so the downscale anti-aliases (1.4× UI on DPR 2 → ss 5, not 3)', () => {
    // 1.4 × 2 = 2.8 device px/design px. Plain ceil would give 3 (ratio 1.07 - no averaging).
    expect(oversampleFor(1.4, 2, 1, 6)).toBe(5); // ratio 5/2.8 ≈ 1.79 ≤ 2
  });

  it('keeps the downscale ratio in (1, 2] across fractional scales (never undersamples the linear tap)', () => {
    for (const scale of [1.05, 1.2, 1.4, 1.6, 1.9, 2.3]) {
      for (const resolution of [1, 1.5, 2]) {
        const device = scale * resolution;
        const ss = oversampleFor(scale, resolution, 1, 100);
        expect(ss / device).toBeGreaterThan(1 - 1e-9);
        expect(ss / device).toBeLessThanOrEqual(2);
      }
    }
  });

  it('stays pixel-exact at integer device scales (a uniform doubled block averages to the source texel)', () => {
    expect(oversampleFor(1, 1, 1, 6)).toBe(2);
    expect(oversampleFor(2, 1, 1, 6)).toBe(4);
    expect(oversampleFor(1, 2, 1, 6)).toBe(4);
  });

  it('applies the quality floor and the memory cap', () => {
    expect(oversampleFor(1.05, 1, 3, 6)).toBe(3); // round-icon floor wins over the tiny target
    expect(oversampleFor(2, 2, 1, 6)).toBe(6); // target 8 capped - a big ?uiscale×DPR cannot balloon memory
  });
});

describe('createReusableBaker', () => {
  it('releases its slot and source when rendering a bake fails', () => {
    const render = vi.fn().mockImplementationOnce(() => {
      throw new Error('context lost');
    });
    const baker = createReusableBaker({ render } as unknown as Renderer);
    const failedSource = new Container();

    expect(() => baker.bake(failedSource, 8, 8, 1)).toThrow('context lost');
    expect(failedSource.destroyed).toBe(true);

    const nextSource = new Container();
    const baked = baker.bake(nextSource, 8, 8, 1);
    expect(render).toHaveBeenCalledTimes(2);
    baked.display.destroy();
    baked.dispose();
    baker.dispose();
  });
});
