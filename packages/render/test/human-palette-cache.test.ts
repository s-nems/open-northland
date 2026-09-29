import { describe, expect, it } from 'vitest';
import { HumanPaletteCache } from '../src/data/palettes/human-palette-cache.js';
import { createHumanPaletteIdentity, HumanPaletteBook } from '../src/data/palettes/human-palettes.js';
import { flatRamp, syntheticLane, TEST_BASE } from './support/human-palettes.js';

const TEAM = 15;
const BAND_BYTES = 48;
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const CAPACITY = 2;

const book = new HumanPaletteBook(
  syntheticLane({ red: flatRamp(255, 0, 0), blue: flatRamp(0, 0, 255) }, [
    { name: 'player_00', patches: [{ band: TEAM, source: { kind: 'ramp', ramp: 'red' }, weight: 1 }] },
    { name: 'woman_00', patches: [{ band: TEAM, source: { kind: 'ramp', ramp: 'blue' }, weight: 1 }] },
  ]),
  TEST_BASE,
);
const look = { body: TEST_BASE, head: TEST_BASE, random: [] };
const identity = (female: boolean) => ({ ...createHumanPaletteIdentity(look), female });
const team = (colours: Uint8Array) => [...colours.subarray(TEAM * BAND_BYTES, TEAM * BAND_BYTES + 3)];

describe('the CPU human palette cache', () => {
  it('keeps a key on the same arrays while its identity holds and composes anew when it changes', () => {
    const cache = new HumanPaletteCache(book, CAPACITY);
    const man = cache.colours(1, identity(false));
    expect(team(man.body)).toEqual(RED);
    expect(cache.colours(1, identity(false))).toBe(man);
    const woman = cache.colours(1, identity(true));
    expect(woman).not.toBe(man);
    expect(team(woman.body)).toEqual(BLUE);
  });

  it('drops the oldest key once full', () => {
    const cache = new HumanPaletteCache(book, CAPACITY);
    const first = cache.colours(1, identity(false));
    cache.colours(2, identity(false));
    cache.colours(3, identity(false));
    expect(cache.colours(1, identity(false))).not.toBe(first);
  });
});
