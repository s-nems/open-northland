import { describe, expect, it } from 'vitest';
import { colonyHomes, type HomesRead } from '../../../../src/systems/computer-player/colony/plan.js';

const SMALL_ROOM = 300;
const FAIR_ROOM = 1200;
const LOTS_OF_ROOM = 2400;

const read = (over: Partial<HomesRead>): HomesRead => ({
  couples: 2,
  fed: true,
  room: SMALL_ROOM,
  people: 14,
  ...over,
});

describe('a colony home', () => {
  it('waits for a couple and for food in store', () => {
    expect(colonyHomes(read({ couples: 0 }))).toBe(0);
    expect(colonyHomes(read({ fed: false }))).toBe(0);
  });

  it('runs to two by the room on the land, and past that only for a big colony with room to spare', () => {
    expect(colonyHomes(read({}))).toBe(1);
    expect(colonyHomes(read({ room: FAIR_ROOM }))).toBe(2);
    expect(colonyHomes(read({ room: LOTS_OF_ROOM }))).toBe(2);
    expect(colonyHomes(read({ room: LOTS_OF_ROOM, people: 30 }))).toBe(3);
  });
});
