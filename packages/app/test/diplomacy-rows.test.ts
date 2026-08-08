import { describe, expect, it } from 'vitest';
import { PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import { type DiplomacySimView, diplomacyPanelRows } from '../src/view/projections/diplomacy-rows.js';

/** A sim stub over explicit met pairs and stances; unset pairs read the sim's `enemy` default. */
function simView(
  met: readonly [number, number][],
  stances: readonly [number, number, 'friend' | 'neutral' | 'enemy'][],
): DiplomacySimView {
  const metSet = new Set(met.map(([v, o]) => `${v}:${o}`));
  const stanceMap = new Map(stances.map(([f, t, s]) => [`${f}:${t}`, s]));
  return {
    hasMetPlayer: (viewer, other) => viewer === other || metSet.has(`${viewer}:${other}`),
    diplomacyStance: (from, to) => stanceMap.get(`${from}:${to}`) ?? 'enemy',
  };
}

describe('diplomacyPanelRows', () => {
  it('lists only discovered roster players, viewer excluded, with both directed stances', () => {
    const sim = simView(
      [[0, 2]],
      [
        [2, 0, 'friend'],
        [0, 2, 'neutral'],
      ],
    );
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1, 2],
      observer: false,
      seatNameOf: (p) => (p === 2 ? 'Mieszkańcy Lasu' : undefined),
    });
    expect(rows).toEqual([
      {
        player: 2,
        name: 'Mieszkańcy Lasu',
        colour: PLAYER_SWATCH_COLORS[2],
        towardYou: 'friend',
        yourStance: 'neutral',
      },
    ]);
  });

  it('leaves the name off an unnamed slot and maps the colour through the roster colour slots', () => {
    const sim = simView([[0, 1]], []);
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1],
      observer: false,
      playerColourOf: () => 5,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('name');
    expect(rows[0]?.colour).toBe(PLAYER_SWATCH_COLORS[5]);
    expect(rows[0]?.towardYou).toBe('enemy'); // the sim default shows through untouched
  });

  it('skips the discovery gate for a spectator, who sees the whole map anyway', () => {
    const sim = simView([], []);
    expect(diplomacyPanelRows(sim, { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: false })).toEqual(
      [],
    );
    expect(
      diplomacyPanelRows(sim, { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: true }).map(
        (r) => r.player,
      ),
    ).toEqual([1, 2]);
  });
});
