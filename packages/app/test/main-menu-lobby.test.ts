import type { MapsIndexPlayerSlot } from '@open-northland/content-resolver/wire';
import { describe, expect, it } from 'vitest';
import {
  initialLobbyOptions,
  initialLobbyState,
  lobbySlotRows,
  lobbyStartEntry,
} from '../src/entries/main-menu/lobby/model.js';
import { setSlotColor, toggleVacantMode } from '../src/entries/main-menu/lobby/roster-state.js';

function slot(player: number, over: Partial<MapsIndexPlayerSlot> = {}): MapsIndexPlayerSlot {
  return {
    player,
    type: 'ai',
    tribeId: 1,
    colorId: player,
    claimable: false,
    hidden: false,
    aiAllowed: true,
    ...over,
  };
}

describe('initialLobbyState', () => {
  it('pre-seats the first claimable listed slot, skipping hidden ones', () => {
    const players = [slot(0, { claimable: true, hidden: true }), slot(1), slot(2, { claimable: true })];
    expect(initialLobbyState(players).seat).toBe(2);
  });

  it('leaves an all-AI roster seatless', () => {
    expect(initialLobbyState([slot(0), slot(1)]).seat).toBeNull();
  });
});

describe('lobbySlotRows', () => {
  const players = [
    slot(0, { claimable: true, type: 'human' }),
    slot(1, { name: 'Jarl Sigurd' }),
    slot(2, { claimable: true }),
    slot(3, { hidden: true }),
  ];

  it('classifies the claimed seat, locked scenario slots and open seats; hidden slots drop', () => {
    const rows = lobbySlotRows(players, initialLobbyState(players));
    expect(rows.map((row) => row.kind)).toEqual(['yours', 'scenario', 'open']);
    expect(rows.map((row) => row.slot.player)).toEqual([0, 1, 2]);
  });

  it('reflects colour picks and vacant-mode toggles', () => {
    let state = initialLobbyState(players);
    const recoloured = setSlotColor(state, 1, 7);
    if (recoloured === null) throw new Error('expected a free colour');
    state = toggleVacantMode(recoloured, 2);
    const rows = lobbySlotRows(players, state);
    expect(rows[1]?.colorId).toBe(7);
    expect(rows[2]?.vacantMode).toBe('idle'); // authored ai default flipped off
  });
});

describe('initialLobbyOptions', () => {
  it('defaults to classic fog and progression on, honouring explicit URL params', () => {
    expect(initialLobbyOptions(new URLSearchParams(''))).toEqual({
      fog: 'reveal',
      professionProgression: true,
    });
    expect(initialLobbyOptions(new URLSearchParams('fog=off&progression=off'))).toEqual({
      fog: 'off',
      professionProgression: false,
    });
    expect(initialLobbyOptions(new URLSearchParams('fog=bogus')).fog).toBe('reveal');
  });
});

describe('lobbyStartEntry', () => {
  it('carries the map, the roster choices and explicit game options', () => {
    const players = [slot(0, { claimable: true, type: 'human' }), slot(1, { claimable: true })];
    const state = initialLobbyState(players);
    const params = new URLSearchParams(
      lobbyStartEntry('zatoka', state, players, { fog: 'recon', professionProgression: false }),
    );
    expect(params.get('map')).toBe('zatoka');
    expect(params.get('player')).toBe('0');
    expect(params.get('ai')).toBe('1'); // the vacant authored-ai seat keeps auto-playing
    expect(params.get('fog')).toBe('recon');
    expect(params.get('progression')).toBe('off');
  });
});
