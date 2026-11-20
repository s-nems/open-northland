import type { MapScript } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seatNameMap } from '../../../src/game/match/seat-names.js';
import { currentLocale, setActiveLocale } from '../../../src/i18n/index.js';

const SCRIPT = {
  players: [
    { player: 0, colorId: 0, type: 'human', name: { pol: 'Ragnar' } },
    { player: 1, colorId: 1, type: 'human', name: { pol: 'Wikingowie 1' } },
    { player: 2, colorId: 2, type: 'human', name: { pol: 'Wikingowie 2' } },
    { player: 3, colorId: 3, type: 'human' },
    { player: 4, colorId: 4, type: 'ai', name: { pol: 'Potwory' } },
    { player: 5, colorId: 5, type: 'human' },
  ],
} as unknown as MapScript;

let previousLocale = currentLocale();
beforeEach(() => {
  previousLocale = currentLocale();
  setActiveLocale('pol');
});
afterEach(() => setActiveLocale(previousLocale));

describe('seatNameMap', () => {
  it('names a computer seat with its lobby level and leaves every other seat as the map names it', () => {
    const nameOf = seatNameMap(
      {
        seats: [
          { player: 0, mode: 'human', color: 0 },
          { player: 1, mode: 'computer', color: 1, difficulty: 'hard' },
          { player: 2, mode: 'computer', color: 2, difficulty: 'easy' },
          { player: 3, mode: 'map-ai', color: 3, difficulty: 'medium' },
          { player: 4, mode: 'map-ai', color: 4 },
          { player: 5, mode: 'human', color: 5 },
        ],
      },
      SCRIPT,
      'pol',
    );
    expect([0, 1, 2, 3, 4, 5].map(nameOf)).toEqual([
      'Ragnar',
      'Wikingowie 1 (Trudny)',
      'Wikingowie 2 (Łatwy)',
      'Gracz 4 (Średni)',
      'Potwory',
      undefined,
    ]);
  });

  it('leads a seat a person sits in now with their nick, beside the map name or the lobby label', () => {
    const sitting = new Map([
      [0, 'Seba'],
      [1, 'Ania'],
      [5, 'Bartek'],
    ]);
    const nameOf = seatNameMap(
      {
        seats: [
          { player: 0, mode: 'human', color: 0 },
          { player: 1, mode: 'computer', color: 1, difficulty: 'hard' },
          { player: 2, mode: 'human', color: 2 },
          { player: 5, mode: 'human', color: 5 },
        ],
      },
      SCRIPT,
      'pol',
      (player) => sitting.get(player),
    );
    expect([0, 1, 2, 5].map(nameOf)).toEqual([
      'Seba (Ragnar)',
      'Ania (Wikingowie 1)',
      'Wikingowie 2',
      'Bartek (Gracz 6)',
    ]);
    // Seba left the seat: it is the map's again.
    sitting.delete(0);
    expect(nameOf(0)).toBe('Ragnar');
  });
});
