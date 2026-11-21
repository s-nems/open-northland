import { describe, expect, it } from 'vitest';
import {
  instancesUnder,
  type PrecipitationSeeds,
  precipitationSeeds,
} from '../../../src/gpu/weather/precipitation-layer.js';
import { SAND_WISP_SHARE } from '../../../src/gpu/weather/precipitation-shader.js';

const CAPACITY = 4096;
const SEED_WIDTH = 4;
const RANK = 3;
const WISP_DRAW = 3;

/** The seeds of `seeds` as `rank -> [a..., b...]`. */
function byRank(seeds: PrecipitationSeeds, count = seeds.held): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const a = Array.from(seeds.a.subarray(i * SEED_WIDTH, (i + 1) * SEED_WIDTH));
    const b = Array.from(seeds.b.subarray(i * SEED_WIDTH, (i + 1) * SEED_WIDTH));
    out.set(a[RANK] ?? -1, [...a, ...b]);
  }
  return out;
}

describe('precipitation seeds', () => {
  const all = precipitationSeeds('sand', CAPACITY, 'all');
  const wisps = precipitationSeeds('sand', CAPACITY, 'wisps');
  const dashes = precipitationSeeds('sand', CAPACITY, 'dashes');

  it('splits sand into wisps and dashes that keep every seed, its rank and its order', () => {
    expect(wisps.held + dashes.held).toBe(CAPACITY);
    expect(new Map([...byRank(wisps), ...byRank(dashes)])).toEqual(byRank(all));
    for (const part of [wisps, dashes]) {
      const ranks = Array.from(part.ranks ?? []);
      expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
      expect(ranks).toEqual(Array.from({ length: part.held }, (_, i) => part.a[i * SEED_WIDTH + RANK]));
    }
  });

  it('holds as wisps exactly the seeds the shader draws as wisps', () => {
    const below = Math.fround(SAND_WISP_SHARE);
    for (let i = 0; i < wisps.held; i++) expect(wisps.b[i * SEED_WIDTH + WISP_DRAW]).toBeLessThan(below);
    for (let i = 0; i < dashes.held; i++) {
      expect(dashes.b[i * SEED_WIDTH + WISP_DRAW]).toBeGreaterThanOrEqual(below);
    }
    // About the share, so the wisp layer no longer shades the other six sevenths.
    expect(wisps.held / CAPACITY).toBeCloseTo(SAND_WISP_SHARE, 1);
  });

  it('draws as a prefix of each part the seeds a prefix of the whole would draw', () => {
    for (const drawn of [0, 1, 7, 500, CAPACITY - 1, CAPACITY, CAPACITY + 9]) {
      const wispCount = instancesUnder(wisps, drawn);
      const dashCount = instancesUnder(dashes, drawn);
      expect(wispCount + dashCount).toBe(Math.min(drawn, CAPACITY));
      expect(new Map([...byRank(wisps, wispCount), ...byRank(dashes, dashCount)])).toEqual(
        byRank(all, instancesUnder(all, drawn)),
      );
    }
  });
});
