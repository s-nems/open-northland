// @vitest-environment jsdom

import { afterEach, expect, it } from 'vitest';
import { keptView } from '../../../src/entries/relay/kept-view.js';
import { createSeatNicks } from '../../../src/entries/relay/seat-nicks.js';

afterEach(() => window.sessionStorage.clear());

it('keeps a seat named by its player after the room clears the nick, and follows a new occupant', () => {
  const nicks = createSeatNicks(null);
  nicks.note({
    seats: [
      { player: 0, nick: 'Ania' },
      { player: 1, nick: 'Bartek' },
      { player: 2, nick: null },
    ],
  });
  // Bartek turned to watching; Cezary took seat 2.
  nicks.note({
    seats: [
      { player: 0, nick: 'Ania' },
      { player: 1, nick: null },
      { player: 2, nick: 'Cezary' },
    ],
  });
  nicks.note(null);
  expect([0, 1, 2, 3].map((player) => nicks.nickOf(player))).toEqual(['Ania', 'Bartek', 'Cezary', undefined]);
});

it('reads the nicks back after a reload of the tab, and forgets them once the game is left', () => {
  const room = (): ReturnType<typeof keptView> => keptView('ws://relay', 'r1');
  createSeatNicks(room()).note({ seats: [{ player: 1, nick: 'Bartek' }] });
  // The reloaded tab hears the seat already cleared.
  const reloaded = createSeatNicks(room());
  reloaded.note({ seats: [{ player: 1, nick: null }] });
  expect(reloaded.nickOf(1)).toBe('Bartek');
  room().set(null);
  expect(createSeatNicks(room()).nickOf(1)).toBeUndefined();
});
