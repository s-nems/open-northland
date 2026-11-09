import { afterEach, describe, expect, it, vi } from 'vitest';
import { knobRecord, mapBenchKnobs } from '../../bench/map-world.js';

/** The session knobs: a browser URL replays as the session it names, and a report's knob record is
 *  how a run is repeated, so the recorded session must read back as itself. */

const MEASURED_TICKS = 100;
const BROWSER_URL =
  'http://localhost:5173/?lang=pol&fog=classic&map=piec_dolin&player=observer&tribes=3:2' +
  '&difficulty=0:hard,3:hard&computer=0,3&seed=144792704&progression=on&needs=on' +
  '&weathermode=map&alliedvision=on';

afterEach(() => vi.unstubAllEnvs());

function knobSearch(): string {
  return mapBenchKnobs(MEASURED_TICKS).session.search;
}

/** The search a run records, read back through `ON_BENCH_SESSION` alone. */
function searchAfterRoundTrip(): string {
  const recorded = knobRecord(mapBenchKnobs(MEASURED_TICKS)).ON_BENCH_SESSION ?? '';
  vi.unstubAllEnvs();
  vi.stubEnv('ON_BENCH_SESSION', recorded);
  return knobSearch();
}

describe('ON_BENCH_SESSION', () => {
  it('keeps every session rule a browser URL names, difficulty included, and drops the rest', () => {
    vi.stubEnv('ON_BENCH_SESSION', BROWSER_URL);
    const search = knobSearch();
    for (const pair of [
      'map=piec_dolin',
      'player=observer',
      'difficulty=0:hard,3:hard',
      'seed=144792704',
      'fog=classic',
      'progression=on',
      'needs=on',
      'weathermode=map',
      'alliedvision=on',
    ]) {
      expect(search.split('&')).toContain(pair);
    }
    expect(search).not.toContain('lang');
    expect(searchAfterRoundTrip()).toBe(search);
  });

  it('reads a bare query with or without its question mark', () => {
    vi.stubEnv('ON_BENCH_SESSION', '?map=piec_dolin&difficulty=1:easy&computer=1');
    const search = knobSearch();
    vi.stubEnv('ON_BENCH_SESSION', 'map=piec_dolin&difficulty=1:easy&computer=1');
    expect(knobSearch()).toBe(search);
    expect(search.split('&')).toContain('difficulty=1:easy');
  });

  it('defaults the fog and seed the benchmark needs and refuses a session without a map', () => {
    vi.stubEnv('ON_BENCH_SESSION', 'map=piec_dolin');
    expect(knobSearch().split('&')).toEqual(expect.arrayContaining(['fog=classic', 'seed=7']));
    vi.stubEnv('ON_BENCH_SESSION', 'lang=pol&seed=3');
    expect(knobSearch).toThrow(/names no map/);
  });

  it('refuses a per-field knob beside it rather than merging the two', () => {
    vi.stubEnv('ON_BENCH_SESSION', BROWSER_URL);
    vi.stubEnv('ON_BENCH_SEED', '7');
    vi.stubEnv('ON_BENCH_NEEDS', 'off');
    expect(knobSearch).toThrow(/ON_BENCH_SESSION .*ON_BENCH_SEED, ON_BENCH_NEEDS/);
  });
});

describe('the per-field session knobs', () => {
  it('record a session that reads back as itself for a count, a list, one seat and none', () => {
    for (const seats of ['3', '1', '3,', '1,2,5', '0']) {
      vi.unstubAllEnvs();
      vi.stubEnv('ON_BENCH_SEATS', seats);
      vi.stubEnv('ON_BENCH_TRIBES', '1:2');
      vi.stubEnv('ON_BENCH_PROGRESSION', 'on');
      const search = knobSearch();
      expect(searchAfterRoundTrip()).toBe(search);
    }
  });

  it('name an observer session over the listed seats', () => {
    vi.stubEnv('ON_BENCH_SEATS', '3,');
    vi.stubEnv('ON_BENCH_NEEDS', 'off');
    expect(knobSearch().split('&')).toEqual(
      expect.arrayContaining(['player=observer', 'computer=3', 'needs=off', 'fog=classic']),
    );
  });
});
