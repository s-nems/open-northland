import { describe, expect, it } from 'vitest';
import {
  FAR_ZOOM_SCALE,
  MUFFLE_FAR_HZ,
  MUFFLE_OPEN_HZ,
  muffleCutoffHz,
  NEAR_ZOOM_SCALE,
  type OneShot,
  PERSPECTIVE_CURVES,
  perspectiveGain,
  shotLayer,
  zoomDistance,
} from '../src/index.js';

/** Zoom as a listening perspective: a zoom distance from the camera scale, and per-layer gains on it. */
describe('zoomDistance', () => {
  it('is 0 at 1:1 and closer, 1 at the widest zoom and past it', () => {
    expect(zoomDistance(NEAR_ZOOM_SCALE)).toBe(0);
    expect(zoomDistance(4)).toBe(0);
    expect(zoomDistance(FAR_ZOOM_SCALE)).toBeCloseTo(1, 9);
    expect(zoomDistance(FAR_ZOOM_SCALE / 2)).toBe(1);
  });

  it('reads a missing or degenerate scale as 1:1', () => {
    expect(zoomDistance(undefined)).toBe(0);
    expect(zoomDistance(0)).toBe(0);
    expect(zoomDistance(Number.NaN)).toBe(0);
  });

  it('moves alike for each equal zoom step (log scale)', () => {
    const mid = Math.sqrt(NEAR_ZOOM_SCALE * FAR_ZOOM_SCALE);
    expect(zoomDistance(mid)).toBeCloseTo(0.5, 9);
  });
});

describe('perspectiveGain', () => {
  it('holds every layer at full gain at 1:1', () => {
    expect(perspectiveGain('detail', 0)).toBe(1);
    expect(perspectiveGain('impact', 0)).toBe(1);
    expect(perspectiveGain('bed', 0)).toBe(1);
  });

  it('fades detail fastest, impacts slowest, and lets the beds hold or rise when zoomed out', () => {
    const detail = perspectiveGain('detail', 1);
    const impact = perspectiveGain('impact', 1);
    const bed = perspectiveGain('bed', 1);
    expect(detail).toBeCloseTo(10 ** (PERSPECTIVE_CURVES.detail.farGainDb / 20), 9);
    expect(detail).toBeLessThan(impact);
    expect(impact).toBeLessThan(1);
    expect(bed).toBeGreaterThanOrEqual(1);
  });
});

describe('muffleCutoffHz', () => {
  it('is open at 1:1, at its gentle far corner when zoomed out, and falls steadily between', () => {
    expect(muffleCutoffHz(0)).toBe(MUFFLE_OPEN_HZ);
    expect(muffleCutoffHz(1)).toBeCloseTo(MUFFLE_FAR_HZ, 6);
    expect(muffleCutoffHz(0.5)).toBeCloseTo(Math.sqrt(MUFFLE_OPEN_HZ * MUFFLE_FAR_HZ), 6);
  });

  it('muffles only the detail layer', () => {
    expect(PERSPECTIVE_CURVES.detail.muffled).toBe(true);
    expect(PERSPECTIVE_CURVES.impact.muffled).toBe(false);
    expect(PERSPECTIVE_CURVES.bed.muffled).toBe(false);
  });
});

describe('shotLayer', () => {
  const shot = (over: Partial<OneShot>): OneShot => ({
    files: ['a.wav'],
    gain: 1,
    pan: 0,
    key: 'k',
    ...over,
  });

  it('keeps a ui shot (no lane, or a jingle) out of every zoom layer', () => {
    expect(shotLayer(shot({}))).toBeNull();
    expect(shotLayer(shot({ lane: { kind: 'jingle', musicType: 1 } }))).toBeNull();
    expect(shotLayer(shot({ layer: 'impact' }))).toBeNull();
  });

  it('keeps a shot off the world bus out of the shot layers', () => {
    expect(shotLayer(shot({ lane: { kind: 'ambience' } }))).toBeNull();
    expect(shotLayer(shot({ bus: 'ambient' }))).toBeNull();
    expect(shotLayer(shot({ bus: 'responses', layer: 'impact' }))).toBeNull();
  });

  it('puts a world shot in detail unless it names its layer', () => {
    expect(shotLayer(shot({ lane: { kind: 'sfx' } }))).toBe('detail');
    expect(shotLayer(shot({ lane: { kind: 'voice' } }))).toBe('detail');
    expect(shotLayer(shot({ lane: { kind: 'sfx' }, layer: 'impact' }))).toBe('impact');
  });
});
