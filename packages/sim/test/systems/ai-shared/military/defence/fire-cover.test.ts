import { describe, expect, it } from 'vitest';
import { hexDistanceBetween } from '../../../../../src/nav/halfcell.js';
import { fireCover } from '../../../../../src/systems/ai-shared/military/defence/fire-cover.js';
import { enemyFire, type Shooter } from '../../../../../src/systems/ai-shared/military/defence/threat.js';

const SHOOTERS: readonly Shooter[] = [
  { x: 10, y: 10, reach: 5 },
  { x: 13, y: 7, reach: 3 },
  { x: 2, y: 21, reach: 6 },
  { x: 25, y: 4, reach: 0 },
  { x: -3, y: -1, reach: 4 },
];
const SPAN = 2;
const HALF_WIDTH = 13;
const HALF_HEIGHT = 12;
const CENTRE_X = 11;
const CENTRE_Y = 9;

describe('fireCover', () => {
  it('covers exactly the nodes some shooter reaches by the hex measure, odd and even rows alike', () => {
    const cover = fireCover(SHOOTERS, CENTRE_X, CENTRE_Y, HALF_WIDTH, HALF_HEIGHT, SPAN);
    for (let y = CENTRE_Y - HALF_HEIGHT; y <= CENTRE_Y + HALF_HEIGHT; y++) {
      for (let x = CENTRE_X - HALF_WIDTH; x <= CENTRE_X + HALF_WIDTH; x++) {
        const expected = SHOOTERS.some((s) => hexDistanceBetween(s.x, s.y, x, y) <= s.reach + SPAN);
        expect(cover.covers(x, y), `(${x}, ${y})`).toBe(expected);
      }
    }
    expect(cover.covers(CENTRE_X + HALF_WIDTH + 1, CENTRE_Y)).toBeNull();
  });

  it('keeps a narrowed fire answering as the plain shooter test over its fan once it reads the cover', () => {
    const radius = 10;
    const narrowed = enemyFire(SHOOTERS).around(CENTRE_X, CENTRE_Y, radius, SPAN);
    const plain = enemyFire(SHOOTERS);
    // Twice over the fan: the first pass spends the tests that switch the fire to its cover.
    for (let pass = 0; pass < 2; pass++) {
      for (let y = CENTRE_Y - radius; y <= CENTRE_Y + radius; y++) {
        for (let x = CENTRE_X - radius - 1; x <= CENTRE_X + radius + 1; x++) {
          if (hexDistanceBetween(CENTRE_X, CENTRE_Y, x, y) > radius) continue;
          expect(narrowed.reaches(x, y, SPAN), `(${x}, ${y})`).toBe(plain.reaches(x, y, SPAN));
        }
      }
    }
  });
});
