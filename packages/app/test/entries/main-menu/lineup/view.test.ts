// @vitest-environment jsdom
import type { MapsIndexPlayerSlot } from '@open-northland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { mapLineup, seatStanceReader } from '../../../../src/entries/main-menu/lineup/model.js';
import { lineupLabel, lineupRoster, relationLine } from '../../../../src/entries/main-menu/lineup/view.js';
import { setActiveLocale } from '../../../../src/i18n/index.js';

function seat(player: number, claimable = true): MapsIndexPlayerSlot {
  return {
    player,
    type: claimable ? 'human' : 'ai',
    tribeId: 1,
    colorId: player,
    claimable,
    hidden: false,
    aiAllowed: true,
    noneAllowed: true,
    hasComputerControl: true,
  };
}

beforeEach(() => setActiveLocale('pol'));

describe('lineup text', () => {
  it('names teams by their sizes and a free-for-all of two as a duel', () => {
    const teams = mapLineup(
      [0, 1, 2].map((player) => seat(player)),
      [
        { a: 0, b: 1, stance: 'ally' },
        { a: 0, b: 2, stance: 'enemy' },
        { a: 1, b: 2, stance: 'enemy' },
      ],
    );
    expect(teams && lineupLabel(teams)).toBe('2 na 1');
    const duel = mapLineup([seat(0), seat(1)], [{ a: 0, b: 1, stance: 'enemy' }]);
    expect(duel && lineupLabel(duel)).toBe('1 na 1');
    const brawl = mapLineup(
      [0, 1, 2].map((player) => seat(player)),
      [
        { a: 0, b: 1, stance: 'enemy' },
        { a: 0, b: 2, stance: 'enemy' },
        { a: 1, b: 2, stance: 'enemy' },
      ],
    );
    expect(brawl && lineupLabel(brawl)).toBe('każdy na każdego');
  });

  it('titles groups only when the roster shows more than one', () => {
    const alone = mapLineup([seat(0), seat(1)], [{ a: 0, b: 1, stance: 'ally' }]);
    expect(lineupRoster(alone, [0, 1]).map((part) => part.kind)).toEqual(['seat', 'seat']);
    const withEnemy = mapLineup(
      [seat(0), seat(1), seat(2, false)],
      [
        { a: 0, b: 1, stance: 'ally' },
        { a: 0, b: 2, stance: 'enemy' },
        { a: 1, b: 2, stance: 'enemy' },
      ],
    );
    expect(
      lineupRoster(withEnemy, [0, 1, 2]).map((part) => (part.kind === 'title' ? part.text : part.player)),
    ).toEqual(['wszyscy w sojuszu', 0, 1, 'Wrogowie wszystkich', 2]);
  });

  it("lists a seat's relations by stance with the seats' numbers", () => {
    const stance = seatStanceReader([
      { a: 0, b: 1, stance: 'ally' },
      { a: 0, b: 3, stance: 'enemy' },
    ]);
    const listed = [0, 1, 2, 3].map((player) => ({ player, color: player }));
    const parts = [...relationLine(0, listed, stance).querySelectorAll('[data-stance]')];
    expect(parts.map((part) => part.getAttribute('aria-label'))).toEqual([
      'Sojusznicy: 2',
      'Wrogowie: 4',
      'Neutralni: 3',
    ]);
  });
});
