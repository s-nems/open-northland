import { describe, expect, it } from 'vitest';
import {
  ComputerModuleId,
  MapAiSeat,
  MapScript,
  mapAllowsComputerControl,
  mapLobbySlots,
  mapSeatRelations,
} from '../src/index.js';

const roster = [
  { player: 0, type: 'human', tribeId: 1, colorId: 0, name: { pol: 'Ragnar' } },
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
        name: { pol: 'Ragnar' },
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
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
        hasComputerControl: true,
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
        hasComputerControl: true,
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

  it('respects master and individual computer-player switches', () => {
    const script = MapScript.parse({
      players: [...roster, { player: 3, type: 'ai', tribeId: 3, colorId: 2 }],
      ai: [
        { player: 1, allDisabled: false, computerDisabled: true, disabledComputerModules: [] },
        { player: 2, allDisabled: true, computerDisabled: false, disabledComputerModules: [] },
        { player: 3, allDisabled: false, computerDisabled: false, disabledComputerModules: ['military'] },
      ],
    });
    expect(
      mapLobbySlots(script).map(({ player, hasComputerControl }) => [player, hasComputerControl]),
    ).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, true],
    ]);
  });

  it('lets an explicit AI-only option reserve a seat whose authored type is human', () => {
    const script = MapScript.parse({
      players: roster,
      multiplayer: { slotOptions: [{ player: 0, allowed: ['ai'] }] },
    });
    expect(mapLobbySlots(script)[0]).toMatchObject({
      type: 'human',
      claimable: false,
      aiAllowed: true,
      noneAllowed: false,
    });
  });
});

describe('mapSeatRelations', () => {
  it('reads both directions of each roster pair: allied only when mutual, enemy when either side', () => {
    const script = MapScript.parse({
      players: [...roster, { player: 3, type: 'ai', tribeId: 3, colorId: 2 }],
      diplomacy: [
        { from: 0, to: 1, state: 'friend' },
        { from: 1, to: 0, state: 'friend' },
        { from: 0, to: 2, state: 'friend' },
        { from: 2, to: 0, state: 'neutral' },
        { from: 3, to: 1, state: 'enemy' },
        { from: 1, to: 3, state: 'friend' },
        // A row naming a seat outside the roster relates nobody the lobby lists.
        { from: 0, to: 7, state: 'enemy' },
      ],
    });
    expect(mapSeatRelations(script)).toEqual([
      { a: 0, b: 1, stance: 'ally' },
      { a: 1, b: 3, stance: 'enemy' },
    ]);
  });
});

it('never offers an authored closed seat even when multiplayer options name human', () => {
  const script = MapScript.parse({
    players: [{ player: 2, type: 'none', tribeId: 1, colorId: 0 }],
    multiplayer: { slotOptions: [{ player: 2, allowed: ['human', 'ai', 'none'] }] },
  });
  expect(mapLobbySlots(script)[0]?.claimable).toBe(false);
});

it('treats disabling every known capability as no computer control without confusing it with the master switch', () => {
  const row = MapAiSeat.parse({
    player: 1,
    allDisabled: false,
    computerDisabled: false,
    disabledComputerModules: ComputerModuleId.options,
  });
  expect(mapAllowsComputerControl(row)).toBe(false);
  expect(row.computerDisabled).toBe(false);
});

it('requires an explicit computer master switch in generated map AI rows', () => {
  expect(
    MapAiSeat.safeParse({
      player: 1,
      allDisabled: false,
      disabledComputerModules: [],
    }).success,
  ).toBe(false);
});
