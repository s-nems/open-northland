import { describe, expect, it } from 'vitest';
import { overallFraction } from '../src/progress-model.js';

/** A stage reporting no `total` only estimates its size, so its fraction never fills its weight. */
describe('overallFraction', () => {
  it('is 0 at the first stage start and 1 only when the last stage completes', () => {
    expect(overallFraction({ stage: 'pictures', done: 0, total: undefined })).toBe(0);
    expect(overallFraction({ stage: 'music', done: 64, total: 64 })).toBe(1);
  });

  it('advances monotonically across stages in pipeline order', () => {
    const atPictures = overallFraction({ stage: 'pictures', done: 500, total: undefined });
    const atAtlases = overallFraction({ stage: 'atlases', done: 10, total: 100 });
    const atMaps = overallFraction({ stage: 'maps', done: 0, total: 121 });
    expect(atPictures).toBeGreaterThan(0);
    expect(atAtlases).toBeGreaterThan(atPictures);
    expect(atMaps).toBeGreaterThan(atAtlases);
  });

  it('caps an estimated stage below its full weight even past the estimate', () => {
    const wayPast = overallFraction({ stage: 'pictures', done: 1_000_000, total: undefined });
    const nextStageStart = overallFraction({ stage: 'atlases', done: 0, total: undefined });
    expect(wayPast).toBeLessThan(nextStageStart);
  });

  it('clamps a known-total stage at its stage weight', () => {
    const over = overallFraction({ stage: 'atlases', done: 200, total: 100 });
    const next = overallFraction({ stage: 'player-colors', done: 0, total: undefined });
    expect(over).toBe(next);
  });
});
