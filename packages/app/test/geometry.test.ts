import { describe, expect, it } from 'vitest';
import { clientToCanvas, type ScreenScale } from '../src/hud/geometry.js';

/**
 * The shared client (CSS) → canvas (screen) point mapping every HUD hit-test and the camera ride on.
 * Pure math over an injected scale, so it is checked headlessly here — the same seam `screenScale`
 * feeds in the live app (see `camera.test.ts` for how the scale itself is derived).
 */
describe('clientToCanvas', () => {
  it('subtracts the canvas origin in CSS px, then scales each axis', () => {
    const scale: ScreenScale = { sx: 1.28, sy: 1.28, rect: { left: 10, top: 20 } };
    expect(clientToCanvas(scale, 10, 20)).toEqual({ x: 0, y: 0 });
    expect(clientToCanvas(scale, 110, 20)).toEqual({ x: 128, y: 0 });
    expect(clientToCanvas(scale, 10, 120)).toEqual({ x: 0, y: 128 });
  });

  it('is identity at a 1:1 scale anchored at the origin', () => {
    const scale: ScreenScale = { sx: 1, sy: 1, rect: { left: 0, top: 0 } };
    expect(clientToCanvas(scale, 42, 7)).toEqual({ x: 42, y: 7 });
  });
});
