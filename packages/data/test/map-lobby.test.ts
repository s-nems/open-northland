import { describe, expect, it } from 'vitest';
import { MapScript, mapLobbySlots } from '../src/index.js';

const roster = [
  { player: 0, type: 'human', tribeId: 1, colorId: 0, name: 'Ragnar' },
  { player: 1, type: 'ai', tribeId: 4, colorId: 9 },
  { player: 2, type: 'ai', tribeId: 2, colorId: 3 },
];

describe('mapLobbySlots', () => {
  it('reads seat eligibility off the authored type when the map ships no [multiplayer] table', () => {
    const script = MapScript.parse({ players: roster });
    expect(mapLobbySlots(script)).toEqual([
      {
        player: 0,
        type: 'human',
        tribeId: 1,
        colorId: 0,
        name: 'Ragnar',
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
      },
      {
        player: 1,
        type: 'ai',
        tribeId: 4,
        colorId: 9,
        claimable: false,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
      },
      {
        player: 2,
        type: 'ai',
        tribeId: 2,
        colorId: 3,
        claimable: false,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
      },
    ]);
  });

  it('lets a playeroption row open an AI seat to a person, deny its AI or None, or hide it', () => {
    const script = MapScript.parse({
      players: roster,
      multiplayer: {
        slotOptions: [
          { player: 1, allowed: ['human', 'ai'] },
          { player: 2, allowed: ['human', 'none'] },
        ],
        hiddenSlots: [2],
      },
    });
    expect(
      mapLobbySlots(script).map(({ player, claimable, hidden, aiAllowed, noneAllowed }) => [
        player,
        claimable,
        hidden,
        aiAllowed,
        noneAllowed,
      ]),
    ).toEqual([
      [0, true, false, true, true],
      [1, true, false, true, false],
      [2, true, true, false, true],
    ]);
  });
});
