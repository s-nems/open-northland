import type { MapsIndexPlayerSlot } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  initialLobbyOptions,
  initialLobbyState,
  lobbySession,
  lobbySlotRows,
  lobbyStartEntry,
} from '../src/entries/main-menu/lobby/model.js';
import {
  claimSeat,
  initialRosterState,
  OBSERVER_SEAT,
  OVERSEER_SEAT,
  type RosterState,
  setSlotColor,
  toggleVacantMode,
} from '../src/entries/main-menu/lobby/roster-state.js';

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
  it('defaults to classic fog, progression on and needs on, honouring explicit URL params', () => {
    expect(initialLobbyOptions(new URLSearchParams(''))).toEqual({
      fog: 'reveal',
      professionProgression: true,
      settlerNeeds: true,
    });
    expect(initialLobbyOptions(new URLSearchParams('fog=off&progression=off&needs=off'))).toEqual({
      fog: 'off',
      professionProgression: false,
      settlerNeeds: false,
    });
    expect(initialLobbyOptions(new URLSearchParams('fog=bogus')).fog).toBe('reveal');
    expect(initialLobbyOptions(new URLSearchParams('needs=bogus')).settlerNeeds).toBe(true);
  });
});

const OPTIONS = { fog: 'reveal', professionProgression: true, settlerNeeds: true } as const;

/** The offered seats the launched session declares as AI, which is what `?ai=` carries. */
function aiSeatsOfLobby(state: RosterState, players: readonly MapsIndexPlayerSlot[]): number[] {
  return lobbySession('zatoka', state, players, OPTIONS)
    .seats.filter(
      (seat) => seat.mode === 'ai' && players.some((p) => p.player === seat.player && p.claimable),
    )
    .map((seat) => seat.player);
}

describe('lobbySession', () => {
  const players = [
    slot(0, { claimable: true, type: 'human', colorId: 7 }),
    slot(1, { claimable: true, type: 'human', colorId: 4 }),
    slot(2, { colorId: 9 }),
  ];

  it('falls back to the default seat on an unclaimed roster, with no offered seat auto-playing', () => {
    // An all-AI roster offers nothing to claim, so Start is not gated on one; the launched game plays
    // the fallback seat, and the descriptor has to say so or it would not survive its own URL. The
    // map's own computer seat (slot 2) plays regardless.
    const state = initialRosterState(players);
    const session = lobbySession('zatoka', state, players, OPTIONS);
    expect(session.localSeat).toBe(0);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['human', 'idle', 'ai']);
    expect(aiSeatsOfLobby(state, players)).toEqual([]);
  });

  it('plays the claimed seat as the person and never lists it as AI', () => {
    let state = toggleVacantMode(initialRosterState(players), 1);
    state = toggleVacantMode(state, 1); // back to the authored idle default
    state = claimSeat(state, 1);
    const session = lobbySession('zatoka', state, players, OPTIONS);
    expect(session.localSeat).toBe(1);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['idle', 'human', 'ai']);
  });

  it('keeps every slot eligible for AI behind a spectator seat', () => {
    let state = claimSeat(initialRosterState(players), OBSERVER_SEAT);
    state = toggleVacantMode(state, 0);
    state = toggleVacantMode(state, 1);
    expect(lobbySession('zatoka', state, players, OPTIONS).localSeat).toBe(OBSERVER_SEAT);
    expect(aiSeatsOfLobby(state, players)).toEqual([0, 1]);
    const overseer = claimSeat(initialRosterState(players), OVERSEER_SEAT);
    expect(lobbySession('zatoka', overseer, players, OPTIONS).localSeat).toBe(OVERSEER_SEAT);
  });

  it('lets a claimable authored-ai slot auto-play until it is toggled to idle', () => {
    const lobby = [slot(0, { claimable: true, type: 'human' }), slot(1, { claimable: true })];
    let state = claimSeat(initialRosterState(lobby), 0);
    expect(aiSeatsOfLobby(state, lobby)).toEqual([1]);
    state = toggleVacantMode(state, 1);
    expect(aiSeatsOfLobby(state, lobby)).toEqual([]);
  });

  it('never plays a seat the map offers no AI for', () => {
    // playeroption without #PLAYER_TYPE_AI (e.g. Zgielk2 slot 0): the authored default is idle even on
    // an authored-ai slot, and a toggle the UI never offers must not leak it into the session either.
    const lobby = [
      slot(0, { claimable: true, type: 'human' }),
      slot(1, { claimable: true, aiAllowed: false }),
    ];
    const state = toggleVacantMode(claimSeat(initialRosterState(lobby), 0), 1);
    expect(aiSeatsOfLobby(state, lobby)).toEqual([]);
  });

  it('carries a recoloured slot and leaves an authored colour alone', () => {
    const recoloured = setSlotColor(claimSeat(initialRosterState(players), 0), 2, 3);
    expect(recoloured).not.toBeNull();
    const session = lobbySession('zatoka', recoloured ?? initialRosterState(players), players, OPTIONS);
    expect(session.seats.map((seat) => seat.color)).toEqual([7, 4, 3]);
    expect(
      new URLSearchParams(
        lobbyStartEntry('zatoka', recoloured ?? initialRosterState(players), players, OPTIONS),
      ).get('colors'),
    ).toBe('2:3');
  });
});

describe('lobbyStartEntry', () => {
  it('carries the map, the roster choices and explicit game options', () => {
    const players = [slot(0, { claimable: true, type: 'human' }), slot(1, { claimable: true })];
    const state = initialLobbyState(players);
    const params = new URLSearchParams(
      lobbyStartEntry('zatoka', state, players, {
        fog: 'recon',
        professionProgression: false,
        settlerNeeds: false,
      }),
    );
    expect(params.get('map')).toBe('zatoka');
    expect(params.get('player')).toBe('0');
    expect(params.get('ai')).toBe('1'); // the vacant authored-ai seat keeps auto-playing
    // The map's own computer seats need no naming: a Forteca-style roster launches with `?ai=` of the
    // offered seats alone, and the session still plays them.
    const forteca = [...players, slot(2), slot(6, { hidden: true })];
    const entry = new URLSearchParams(
      lobbyStartEntry('forteca', initialLobbyState(forteca), forteca, OPTIONS),
    );
    expect(entry.get('ai')).toBe('1');
    expect(
      lobbySession('forteca', initialLobbyState(forteca), forteca, OPTIONS).seats.map((seat) => seat.mode),
    ).toEqual(['human', 'ai', 'ai', 'ai']);
    expect(params.get('fog')).toBe('recon');
    expect(params.get('progression')).toBe('off');
    expect(params.get('needs')).toBe('off');
  });

  it('writes the needs default explicitly, so a carried `needs=off` cannot leak into the next map', () => {
    const players = [slot(0, { claimable: true, type: 'human' })];
    const entry = lobbyStartEntry('zatoka', initialLobbyState(players), players, {
      fog: 'reveal',
      professionProgression: true,
      settlerNeeds: true,
    });
    expect(new URLSearchParams(entry).get('needs')).toBe('on');
  });
});
