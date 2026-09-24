import { afterEach, describe, expect, it, vi } from 'vitest';
import { knobRecord, mapBenchKnobs } from '../bench/map-world.js';

/** A report's knob record is how a run is repeated, so every seat list must read back as itself. */

const MEASURED_TICKS = 100;

afterEach(() => vi.unstubAllEnvs());

function seatsAfterRoundTrip(raw: string): readonly number[] {
  vi.stubEnv('ON_BENCH_SEATS', raw);
  const recorded = knobRecord(mapBenchKnobs(MEASURED_TICKS)).ON_BENCH_SEATS ?? '';
  vi.stubEnv('ON_BENCH_SEATS', recorded);
  return mapBenchKnobs(MEASURED_TICKS).seats;
}

describe('ON_BENCH_SEATS in the knob record', () => {
  it('reads back as the same seats for a count, a list, one seat and none', () => {
    expect(seatsAfterRoundTrip('3')).toEqual([0, 1, 2]);
    expect(seatsAfterRoundTrip('1')).toEqual([0]);
    expect(seatsAfterRoundTrip('3,')).toEqual([3]);
    expect(seatsAfterRoundTrip('1,2,5')).toEqual([1, 2, 5]);
    expect(seatsAfterRoundTrip('0')).toEqual([]);
  });
});
