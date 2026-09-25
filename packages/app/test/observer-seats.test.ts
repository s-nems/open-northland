import type { MapScript } from '@open-northland/data';
import { type GameSession, OBSERVER_SEAT } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import { observerSeats } from '../src/game/observer-seats.js';

/** A Forteca-style roster: two seats a person may take, a computer the lobby may place, the map's
 *  own locked computer seat, and a hidden one the lobby never lists. */
const SCRIPT = {
  players: [
    { player: 0, colorId: 0, type: 'human', name: 'Ragnar' },
    { player: 1, colorId: 1, type: 'human' },
    { player: 2, colorId: 2, type: 'ai' },
    { player: 3, colorId: 3, type: 'ai', name: 'Wrogowie' },
    { player: 4, colorId: 4, type: 'ai', name: 'Ukryci' },
  ],
  multiplayer: {
    slotOptions: [
      { player: 0, allowed: ['human', 'ai'] },
      { player: 1, allowed: ['human', 'ai'] },
      { player: 2, allowed: ['human', 'ai'] },
      { player: 3, allowed: ['ai'] },
    ],
    hiddenSlots: [4],
  },
} as unknown as MapScript;

function session(seats: GameSession['seats']): GameSession {
  return {
    world: { kind: 'map', mapId: 'forteca' },
    seed: 1,
    seats,
    localSeat: OBSERVER_SEAT,
    rules: { fog: null, progression: null, needs: null },
    speed: 1,
  };
}

describe('observerSeats', () => {
  it('lists every played seat ascending, the map’s locked and hidden computers included', () => {
    const seats = observerSeats(
      session([
        { player: 2, mode: 'ai', color: 2 },
        { player: 0, mode: 'human', color: 0 },
        { player: 4, mode: 'ai', color: 4 },
        { player: 1, mode: 'human', color: 1 },
        { player: 3, mode: 'ai', color: 3 },
      ]),
      SCRIPT,
    );
    expect(seats).toEqual([
      { player: 0, name: 'Ragnar' },
      { player: 1 },
      { player: 2 },
      { player: 3, name: 'Wrogowie' },
      { player: 4, name: 'Ukryci' },
    ]);
  });

  it('skips a seat sitting the game out', () => {
    const seats = observerSeats(
      session([
        { player: 0, mode: 'human', color: 0 },
        { player: 1, mode: 'idle', color: 1 },
        { player: 3, mode: 'ai', color: 3 },
      ]),
      SCRIPT,
    );
    expect(seats.map((seat) => seat.player)).toEqual([0, 3]);
  });

  it('keeps every played seat of a world without a roster script', () => {
    const seats = observerSeats(
      session([
        { player: 0, mode: 'human', color: 0 },
        { player: 5, mode: 'ai', color: 5 },
      ]),
      null,
    );
    expect(seats).toEqual([{ player: 0 }, { player: 5 }]);
  });
});
