import { describe, expect, it } from 'vitest';
import {
  type HomewardRead,
  homewardCargo,
  type OutwardRead,
  outwardCargo,
} from '../../../../src/systems/computer-player/colony/demand.js';

const FOOD = 16;
const WOOD = 5;
const STONE = 3;
const SHOES = 30;
const SWORD = 41;
const PLENTY = 500;

const outward = (read: Partial<OutwardRead>): OutwardRead => ({
  room: 40,
  food: FOOD,
  foodHeld: 0,
  mouths: 0,
  owed: new Map(),
  held: new Map(),
  wanted: new Map(),
  makes: new Set(),
  spare: () => PLENTY,
  ...read,
});

const homeward = (read: Partial<HomewardRead>): HomewardRead => ({
  room: 40,
  staples: [WOOD, STONE],
  held: new Map(),
  kept: new Map(),
  lackToComfort: () => PLENTY,
  lackToGlut: () => PLENTY,
  crafted: [],
  finished: [],
  ...read,
});

describe('an outward load', () => {
  it('takes food to a meal a mouth, then the sites, then what buildings want', () => {
    const lines = outwardCargo(
      outward({
        mouths: 12,
        foodHeld: 2,
        owed: new Map([[WOOD, 10]]),
        held: new Map([[WOOD, 4]]),
        wanted: new Map([[SHOES, 5]]),
      }),
    );
    expect(lines).toEqual([
      { goodType: FOOD, amount: 10 },
      { goodType: WOOD, amount: 6 },
      { goodType: SHOES, amount: 5 },
    ]);
  });

  it('runs out of room on the last step and spares home what it lacks', () => {
    const lines = outwardCargo(
      outward({
        room: 12,
        mouths: 10,
        owed: new Map([[WOOD, 10]]),
        spare: (good) => (good === FOOD ? 4 : PLENTY),
      }),
    );
    expect(lines).toEqual([
      { goodType: FOOD, amount: 4 },
      { goodType: WOOD, amount: 8 },
    ]);
  });

  it('never takes what the colony makes or digs itself', () => {
    const lines = outwardCargo(
      outward({
        owed: new Map([
          [WOOD, 10],
          [STONE, 4],
        ]),
        wanted: new Map([[WOOD, 5]]),
        makes: new Set([WOOD]),
      }),
    );
    expect(lines).toEqual([{ goodType: STONE, amount: 4 }]);
  });
});

describe('a homeward load', () => {
  it('keeps what the colony owes its own sites and shares the rest between the staples', () => {
    const lines = homewardCargo(
      homeward({
        held: new Map([
          [WOOD, 45],
          [STONE, 45],
        ]),
        kept: new Map([[WOOD, 12]]),
      }),
    );
    expect(lines).toEqual([
      { goodType: WOOD, amount: 20 },
      { goodType: STONE, amount: 20 },
    ]);
  });

  it('hands a staple home lacks little of over to the other, and stops at the glut', () => {
    const lines = homewardCargo(
      homeward({
        held: new Map([
          [WOOD, 45],
          [STONE, 45],
        ]),
        lackToComfort: (good) => (good === WOOD ? 30 : 0),
        lackToGlut: (good) => (good === WOOD ? 35 : 0),
      }),
    );
    expect(lines).toEqual([{ goodType: WOOD, amount: 35 }]);
  });

  it('takes what the workshops made ahead of the staples', () => {
    const lines = homewardCargo(
      homeward({
        held: new Map([
          [WOOD, 45],
          [SWORD, 5],
        ]),
        crafted: [SWORD],
      }),
    );
    expect(lines[0]).toEqual({ goodType: SWORD, amount: 5 });
  });

  it('fills what is left with finished goods', () => {
    const lines = homewardCargo(
      homeward({
        held: new Map([
          [WOOD, 8],
          [SWORD, 3],
        ]),
        finished: [SWORD],
      }),
    );
    expect(lines).toEqual([
      { goodType: WOOD, amount: 8 },
      { goodType: SWORD, amount: 3 },
    ]);
  });
});
