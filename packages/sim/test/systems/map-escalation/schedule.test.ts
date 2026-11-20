import { MapSiege } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import {
  apportion,
  attackBeaten,
  launchTick,
  refillMen,
  waveSize,
} from '../../../src/systems/map-escalation/schedule.js';

const SWORD = 'soldier_sword_long';
const SHORT = 'soldier_sword_short';
const BOW = 'soldier_bow_long';
const MIX = [
  { job: SWORD, weight: 2 },
  { job: SHORT, weight: 1 },
  { job: BOW, weight: 2 },
];

const CONFIG = MapSiege.parse({
  version: 1,
  stronghold: { seat: 6, building: 'barracks', x: 1, y: 1, range: 1 },
  tribe: 'frank',
  jobMix: MIX,
  attacks: {
    launches: [
      { atSeconds: 100, landMen: 10, ships: 0 },
      { atSeconds: 200, landMen: 20, ships: 2 },
    ],
    repeat: {
      everySeconds: 100,
      waves: [
        { landMen: 1, ships: 0 },
        { landMen: 2, ships: 3 },
      ],
    },
    endDeadPct: 80,
    endAfterSeconds: 10,
    targets: [{ seat: 0, raider: 7, x: 1, y: 1 }],
  },
  guard: {
    base: 1,
    perSeatStep: 1,
    stepSeconds: 10,
    perSeatMax: 1,
    refill: { everySeconds: 40, baseMen: 2, stepMen: 1, stepSeconds: 900, maxMen: 16 },
  },
});

const at = (seconds: number) => seconds * TICKS_PER_SECOND;

describe('map escalation schedule', () => {
  it('splits a spawn by weight, the larger remainders and then the earlier trade taking the rest', () => {
    expect(apportion(MIX, 10)).toEqual([SWORD, SWORD, SWORD, SWORD, SHORT, SHORT, BOW, BOW, BOW, BOW]);
    expect(apportion(MIX, 3)).toEqual([SWORD, SHORT, BOW]);
    expect(apportion(MIX, 4)).toEqual([SWORD, SWORD, SHORT, BOW]);
  });

  it('repeats past the scheduled launches on its interval, cycling the repeat waves', () => {
    expect([0, 1, 2, 3, 4].map((i) => launchTick(CONFIG, i))).toEqual([100, 200, 300, 400, 500].map(at));
    expect([1, 2, 3, 4].map((i) => waveSize(CONFIG, i).ships)).toEqual([2, 0, 3, 0]);
  });

  it('ends an attack once its dead share reaches the configured part of the men it sent', () => {
    expect(attackBeaten(CONFIG, 10, 3)).toBe(false);
    expect(attackBeaten(CONFIG, 10, 2)).toBe(true);
    expect(attackBeaten(CONFIG, 11, 3)).toBe(false);
  });

  it('pulses the refill one interval in, a man more for every completed step, up to its max', () => {
    const MINUTE = 60;
    expect([0, 20, 40].map((s) => refillMen(CONFIG, at(s)))).toEqual([0, 0, 2]);
    // 1:00, 2:00 and 3:00 into the game, then far past the cap.
    expect([60, 120, 180, 600].map((m) => refillMen(CONFIG, at(m * MINUTE)))).toEqual([6, 10, 14, 16]);
  });
});
