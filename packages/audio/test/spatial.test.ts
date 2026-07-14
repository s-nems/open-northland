import { type Camera, tileToScreen } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { CULL_MARGIN_PX, computeSpatial, EDGE_GAIN, MAX_PAN, ZOOM_GAIN_FLOOR } from '../src/index.js';

/**
 * The pure spatial-audio math: an emitter is silent (null) off screen, full-gain + centre-pan at the
 * screen centre, and attenuated + panned toward the edge near a border. No AudioContext — the "only
 * what's on screen makes sound" contract is checked headless.
 */
describe('computeSpatial', () => {
  const CANVAS_W = 800;
  const CANVAS_H = 600;
  // A camera that projects tile (0,0) — which tileToScreen maps to (0,0) — to the screen centre.
  const centred: Camera = { offsetX: CANVAS_W / 2, offsetY: CANVAS_H / 2, scale: 1 };

  it('is loudest and centre-panned at the screen centre', () => {
    const s = computeSpatial(0, 0, centred, CANVAS_W, CANVAS_H);
    expect(s).not.toBeNull();
    expect(s?.gain).toBeCloseTo(1, 5);
    expect(s?.pan).toBeCloseTo(0, 5);
  });

  it('attenuates and pans left for an emitter on the left of the screen', () => {
    // tileToScreen(0,0)=(0,0); with a small offset the emitter sits near the left edge.
    const cam: Camera = { offsetX: 40, offsetY: CANVAS_H / 2, scale: 1 };
    const s = computeSpatial(0, 0, cam, CANVAS_W, CANVAS_H);
    expect(s).not.toBeNull();
    expect(s?.pan).toBeLessThan(0); // left of centre
    expect(s?.gain).toBeLessThan(1); // off-centre → quieter
    expect(s?.gain).toBeGreaterThanOrEqual(EDGE_GAIN);
    expect(Math.abs(s?.pan ?? 0)).toBeLessThanOrEqual(MAX_PAN + 1e-9);
  });

  it('returns null (silent) for an emitter well off screen', () => {
    // tile (100,100) → tileToScreen y = (100+100)*16 = 3200 px, far below a 600px canvas.
    expect(computeSpatial(100, 100, centred, CANVAS_W, CANVAS_H)).toBeNull();
  });

  it('keeps an emitter just past the edge audible within the cull margin', () => {
    // Place the emitter a little past the right edge but inside CULL_MARGIN_PX.
    const cam: Camera = { offsetX: CANVAS_W + CULL_MARGIN_PX / 2, offsetY: CANVAS_H / 2, scale: 1 };
    const s = computeSpatial(0, 0, cam, CANVAS_W, CANVAS_H);
    expect(s).not.toBeNull();
    expect(s?.pan).toBeGreaterThan(0); // to the right
  });

  it('respects the camera zoom when projecting', () => {
    // At scale 2, tile (10,0) → tileToScreen (320,160) → screen (640,320)+offset. Still on screen.
    const cam: Camera = { offsetX: 0, offsetY: 0, scale: 2 };
    const onScreen = computeSpatial(2, 0, cam, CANVAS_W, CANVAS_H); // (128,64) → on screen
    expect(onScreen).not.toBeNull();
    const offScreen = computeSpatial(20, 0, cam, CANVAS_W, CANVAS_H); // (1280,640) → off screen
    expect(offScreen).toBeNull();
  });

  it('attenuates as the camera zooms out and never boosts past full when zoomed in', () => {
    // Keep the same tile dead-centre at every zoom (offset compensates for scale), so only the zoom
    // factor varies — gain then equals the zoom attenuation alone (centre screen-gain is 1).
    const col = 3;
    const row = 4;
    const s = tileToScreen(col, row);
    const centredAt = (scale: number): Camera => ({
      offsetX: CANVAS_W / 2 - s.x * scale,
      offsetY: CANVAS_H / 2 - s.y * scale,
      scale,
    });
    const gainAt = (scale: number): number =>
      computeSpatial(col, row, centredAt(scale), CANVAS_W, CANVAS_H)?.gain ?? Number.NaN;

    expect(gainAt(1)).toBeCloseTo(1, 5); // 1:1 → full
    expect(gainAt(2)).toBeCloseTo(1, 5); // zoomed in → capped at full, no boost
    expect(gainAt(0.5)).toBeCloseTo(0.5, 5); // zoomed out → attenuated to the zoom factor
    expect(gainAt(0.05)).toBeCloseTo(ZOOM_GAIN_FLOOR, 5); // far out → floored, never silent
    // Monotonic: the more you zoom out, the quieter.
    expect(gainAt(0.5)).toBeLessThan(gainAt(1));
    expect(gainAt(0.2)).toBeLessThan(gainAt(0.5));
  });
});
