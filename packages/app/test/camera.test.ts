import type { Camera } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, panCamera, zoomCameraAt } from '../src/camera.js';

/**
 * The headless half of the interactive camera: the pan/zoom *math* is pure, so it's unit-tested here.
 * The DOM wiring (`createCameraController`'s mouse/wheel/key listeners) and the *feel* of the result are
 * human-gated — see the `npm run dev` check in the iteration closeout.
 */

describe('panCamera', () => {
  it('shifts the offset by the delta and preserves scale', () => {
    const cam: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
    expect(panCamera(cam, 10, -5)).toEqual({ offsetX: 110, offsetY: 45, scale: 2 });
  });

  it('leaves an unscaled camera unscaled (no scale field invented)', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0 };
    const out = panCamera(cam, 7, 8);
    expect(out).toEqual({ offsetX: 7, offsetY: 8 });
    expect(out.scale).toBeUndefined();
  });
});

describe('zoomCameraAt', () => {
  /** screen = world*scale + offset. */
  const screenOf = (cam: Camera, worldX: number): number => worldX * (cam.scale ?? 1) + cam.offsetX;

  it('keeps the world point under the cursor pinned to that screen pixel', () => {
    const cam: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
    const cursorX = 300;
    const cursorY = 200;
    // World point currently under the cursor, before zooming.
    const worldX = (cursorX - cam.offsetX) / (cam.scale ?? 1);
    const worldY = (cursorY - cam.offsetY) / (cam.scale ?? 1);
    const out = zoomCameraAt(cam, 2, cursorX, cursorY);
    expect(out.scale).toBe(4);
    // That same world point still projects to the cursor under the new camera.
    expect(out.offsetX + worldX * 4).toBeCloseTo(cursorX);
    expect(out.offsetY + worldY * 4).toBeCloseTo(cursorY);
  });

  it('treats a missing scale as 1', () => {
    const out = zoomCameraAt({ offsetX: 0, offsetY: 0 }, 2, 10, 10);
    expect(out.scale).toBe(2);
    // The point under the cursor (world 10 at scale 1) stays under the cursor at scale 2.
    expect(screenOf(out, 10)).toBeCloseTo(10);
  });

  it('clamps zoom-in at MAX_ZOOM and returns the camera untouched once clamped', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0, scale: MAX_ZOOM };
    expect(zoomCameraAt(cam, 2, 100, 100)).toBe(cam); // identity when the clamp leaves scale unchanged
  });

  it('clamps zoom-out at MIN_ZOOM', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0, scale: MIN_ZOOM };
    expect(zoomCameraAt(cam, 0.5, 100, 100)).toBe(cam);
    const partway = zoomCameraAt({ offsetX: 0, offsetY: 0, scale: MIN_ZOOM * 1.05 }, 0.5, 0, 0);
    expect(partway.scale).toBe(MIN_ZOOM);
  });
});
