import { describe, expect, it } from 'vitest';
import { overallFraction } from '../src/progress-model.js';

/**
 * The installer's bar math (`src/progress-model.ts`). Invariants: monotone within a stage and
 * across stage boundaries in pipeline order, clamped to 0..1, and an estimated (total-less) stage
 * never claims its own completion.
 */
describe('overallFraction', () => {
  it('is 0 at the first stage start and 1 only when the last stage completes', () => {
    expect(overallFraction({ stage: 'unpack', done: 0, total: undefined })).toBe(0);
    expect(overallFraction({ stage: 'maps', done: 121, total: 121 })).toBe(1);
  });

  it('advances monotonically across stages in pipeline order', () => {
    const atUnpack = overallFraction({ stage: 'unpack', done: 500, total: undefined });
    const atPictures = overallFraction({ stage: 'pictures', done: 0, total: undefined });
    const atAtlases = overallFraction({ stage: 'atlases', done: 10, total: 100 });
    const atMaps = overallFraction({ stage: 'maps', done: 0, total: 121 });
    expect(atUnpack).toBeGreaterThan(0);
    expect(atPictures).toBeGreaterThanOrEqual(atUnpack);
    expect(atAtlases).toBeGreaterThan(atPictures);
    expect(atMaps).toBeGreaterThan(atAtlases);
  });

  it('caps an estimated stage below its full weight even past the estimate', () => {
    const wayPast = overallFraction({ stage: 'unpack', done: 1_000_000, total: undefined });
    const nextStageStart = overallFraction({ stage: 'pictures', done: 0, total: undefined });
    expect(wayPast).toBeLessThan(nextStageStart);
  });

  it('clamps a known-total stage at its stage weight', () => {
    const over = overallFraction({ stage: 'atlases', done: 200, total: 100 });
    const next = overallFraction({ stage: 'player-colors', done: 0, total: undefined });
    expect(over).toBe(next);
  });
});
