import { describe, expect, it } from 'vitest';
import { snapCameraToDevicePixels } from '../src/data/iso.js';

describe('snapCameraToDevicePixels', () => {
  it('rounds pan offsets to whole device pixels at resolution 1', () => {
    const cam = snapCameraToDevicePixels({ offsetX: 10.4, offsetY: -3.6, scale: 2 }, 1);
    expect(cam).toEqual({ offsetX: 10, offsetY: -4, scale: 2 });
  });

  it('snaps to half-CSS-pixel steps on a DPR-2 canvas (one device pixel)', () => {
    const cam = snapCameraToDevicePixels({ offsetX: 10.3, offsetY: 0.26 }, 2);
    expect(cam.offsetX).toBeCloseTo(10.5);
    expect(cam.offsetY).toBeCloseTo(0.5);
  });

  it('returns the same object when already snapped (no per-frame allocation)', () => {
    const cam = { offsetX: 12, offsetY: -7, scale: 0.5 };
    expect(snapCameraToDevicePixels(cam, 1)).toBe(cam);
  });

  it('treats a non-positive resolution as 1 (defensive)', () => {
    expect(snapCameraToDevicePixels({ offsetX: 1.5, offsetY: 0 }, 0).offsetX).toBe(2);
  });
});
