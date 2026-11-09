import { MAP_TYPE, type MapsIndexPlayerSlot, WEREWOLF_TRIBE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  initialLobbyOptions,
  initialLobbyState,
  lobbyPlayers,
  lobbySession,
  lobbySlotRows,
  lobbyStartEntry,
} from '../../../../src/entries/main-menu/lobby/model.js';
import {
  claimSeat,
  initialRosterState,
  OBSERVER_SEAT,
  type RosterState,
  setSlotColor,
  setSlotDifficulty,
  setSlotTribe,
  setVacantMode,
} from '../../../../src/entries/main-menu/lobby/roster-state.js';
import { localAlliedVision } from '../../../../src/game/match/session-rules.js';
import { mapSession } from '../../../../src/game/match/session-url.js';

/** `TRIBE_TYPE_HUMAN_*` codes the rosters below name. */
const VIKING = 1;
const SARACEN = 4;

function slot(player: number, over: Partial<MapsIndexPlayerSlot> = {}): MapsIndexPlayerSlot {
  return {
    player,
    type: 'ai',
    tribeId: VIKING,
    colorId: player,
    claimable: false,
    hidden: false,
    aiAllowed: true,
    noneAllowed: true,
    hasComputerControl: true,
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

describe('lobbyPlayers', () => {
  /** Forteca's two villages: map AI seats the authored map reserves and Ragnarök opens. */
  const VILLAGES = [4, 5];
  const forteca = [
    slot(0, { claimable: true }),
    ...VILLAGES.map((player) => slot(player, { aiAllowed: true, noneAllowed: false })),
  ];

  it('opens the seats a picked variant offers, and launches the variant', () => {
    const players = lobbyPlayers('specjalna_forteca', forteca, 'ragnarok');
    const state = initialLobbyState(players);

    expect(lobbySlotRows(players, state).map((row) => row.kind)).toEqual(['yours', 'open', 'open']);
    expect(lobbySlotRows(forteca, initialLobbyState(forteca)).map((row) => row.kind)).toEqual([
      'yours',
      'scenario',
      'scenario',
    ]);
    const session = lobbySession('specjalna_forteca', state, players, OPTIONS, SEED, 'ragnarok');
    expect(session.world).toEqual({ kind: 'map', mapId: 'specjalna_forteca', variant: 'ragnarok' });
    expect(session.seats.filter((seat) => VILLAGES.includes(seat.player)).map((seat) => seat.mode)).toEqual([
      'computer',
      'computer',
    ]);
  });

  it('keeps the roster of a map without that variant', () => {
    expect(lobbyPlayers('zatoka', forteca, 'ragnarok')).toBe(forteca);
  });
});

describe('lobbySlotRows', () => {
  const players = [
    slot(0, { claimable: true, type: 'human' }),
    slot(1, { name: { pol: 'Jarl Sigurd' } }),
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
    state = setVacantMode(recoloured, 2, 'idle');
    const rows = lobbySlotRows(players, state);
    expect(rows[1]?.colorId).toBe(7);
    expect(rows[2]?.vacantMode).toBe('idle'); // authored ai default flipped off
  });

  it('offers a civilization pick on every civilization seat and none on a monster seat', () => {
    const roster = [...players, slot(4, { tribeId: WEREWOLF_TRIBE })];
    const rows = lobbySlotRows(roster, setSlotTribe(initialLobbyState(roster), 1, SARACEN));
    expect(rows.map((row) => row.offersTribe)).toEqual([true, true, true, false]);
    expect(rows.map((row) => row.tribe)).toEqual([VIKING, SARACEN, VIKING, WEREWOLF_TRIBE]);
  });
});

describe('initialLobbyOptions', () => {
  it('defaults to classic fog, progression on, needs on and variable weather, honouring explicit URL params', () => {
    expect(initialLobbyOptions(new URLSearchParams(''), true)).toEqual({
      fog: 'classic',
      professionProgression: true,
      settlerNeeds: true,
      weather: 'map',
      dayNight: 'map',
      alliedVision: true,
      peace: null,
    });
    expect(
      initialLobbyOptions(
        new URLSearchParams('fog=recon-fow&progression=off&needs=off&weathermode=winter&daynight=on'),
        true,
      ),
    ).toEqual({
      fog: 'recon-fow',
      professionProgression: false,
      settlerNeeds: false,
      weather: 'winter',
      dayNight: 'on',
      alliedVision: true,
      peace: null,
    });
    expect(initialLobbyOptions(new URLSearchParams('weathermode=bogus'), true).weather).toBe('map');
    // The revealed map is a debug-menu pick, never a lobby one.
    expect(initialLobbyOptions(new URLSearchParams('fog=off'), true).fog).toBe('classic');
    expect(initialLobbyOptions(new URLSearchParams('fog=bogus'), true).fog).toBe('classic');
    expect(initialLobbyOptions(new URLSearchParams('needs=bogus'), true).settlerNeeds).toBe(true);
  });

  it('starts a local game with allied vision on for a multiplayer map and off for a single-player one', () => {
    expect(localAlliedVision([MAP_TYPE.SINGLE_PLAYER_FREE])).toBe(false);
    expect(localAlliedVision([])).toBe(false);
    expect(localAlliedVision([MAP_TYPE.MULTI_PLAYER_FREE])).toBe(true);
    expect(localAlliedVision([MAP_TYPE.USER_MULTI_PLAYER_FREE])).toBe(true);
    // Not carried: a stray launch flag cannot override the caller's pick.
    expect(initialLobbyOptions(new URLSearchParams('alliedvision=off'), true).alliedVision).toBe(true);
  });

  it('starts every lobby without a peace, whatever the launch URL says', () => {
    expect(initialLobbyOptions(new URLSearchParams('peace=90'), true).peace).toBeNull();
  });
});

const SEED = 42;
const OPTIONS = {
  fog: 'classic',
  professionProgression: true,
  settlerNeeds: true,
  weather: 'winter',
  dayNight: 'map',
  alliedVision: true,
  peace: null,
} as const;

/** The offered seats the launched session declares as AI, which is what `?computer=` carries. */
function computerSeatsOfLobby(state: RosterState, players: readonly MapsIndexPlayerSlot[]): number[] {
  return lobbySession('zatoka', state, players, OPTIONS, SEED)
    .seats.filter(
      (seat) => seat.mode === 'computer' && players.some((p) => p.player === seat.player && p.claimable),
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
    const session = lobbySession('zatoka', state, players, OPTIONS, SEED);
    expect(session.localSeat).toBe(0);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['human', 'idle', 'map-ai']);
    expect(computerSeatsOfLobby(state, players)).toEqual([]);
  });

  it('plays the claimed seat as the person and never lists it as AI', () => {
    const state = claimSeat(initialRosterState(players), 1);
    const session = lobbySession('zatoka', state, players, OPTIONS, SEED);
    expect(session.localSeat).toBe(1);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['computer', 'human', 'map-ai']);
  });

  it('keeps every slot eligible for AI behind a spectator seat', () => {
    let state = claimSeat(initialRosterState(players), OBSERVER_SEAT);
    state = setVacantMode(state, 0, 'computer');
    state = setVacantMode(state, 1, 'computer');
    expect(lobbySession('zatoka', state, players, OPTIONS, SEED).localSeat).toBe(OBSERVER_SEAT);
    expect(computerSeatsOfLobby(state, players)).toEqual([0, 1]);
  });

  it('lets a claimable authored-ai slot auto-play until it is toggled to idle', () => {
    const lobby = [slot(0, { claimable: true, type: 'human' }), slot(1, { claimable: true })];
    let state = claimSeat(initialRosterState(lobby), 0);
    expect(lobbySession('zatoka', state, lobby, OPTIONS, SEED).seats[1]?.mode).toBe('computer');
    state = setVacantMode(state, 1, 'idle');
    expect(computerSeatsOfLobby(state, lobby)).toEqual([]);
  });

  it('never plays a seat the map offers no AI for', () => {
    // playeroption without #PLAYER_TYPE_AI (e.g. Zgielk2 slot 0): the authored default is idle even on
    // an authored-ai slot, and a toggle the UI never offers must not leak it into the session either.
    const lobby = [
      slot(0, { claimable: true, type: 'human' }),
      slot(1, { claimable: true, aiAllowed: false, noneAllowed: true }),
    ];
    const state = setVacantMode(claimSeat(initialRosterState(lobby), 0), 1, 'computer');
    expect(computerSeatsOfLobby(state, lobby)).toEqual([]);
  });

  it('round-trips an offered None choice without removing locked or forbidden seats', () => {
    const lobby = [
      slot(0, { claimable: true, type: 'human' }),
      slot(1, { claimable: true, noneAllowed: true }),
      slot(2, { claimable: true, noneAllowed: false }),
      slot(3, { claimable: false, noneAllowed: true }),
    ];
    let state = claimSeat(initialRosterState(lobby), 0);
    for (const player of [1, 2, 3]) state = setVacantMode(state, player, 'absent');
    const session = lobbySession('zatoka', state, lobby, OPTIONS, SEED);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['human', 'absent', 'computer', 'map-ai']);
    const entry = new URLSearchParams(lobbyStartEntry('zatoka', state, lobby, OPTIONS, SEED));
    expect(entry.get('absent')).toBe('1');
    expect(mapSession(entry, lobby)).toEqual(session);
    expect(lobbySession('zatoka', claimSeat(state, 1), lobby, OPTIONS, SEED).seats[1]?.mode).toBe('human');
  });

  it('leaves authored closed seats absent even if a stale selection names them', () => {
    const lobby = [...players, slot(3, { type: 'none' })];
    const state = claimSeat(initialRosterState(lobby), 0);
    const session = lobbySession('zatoka', state, lobby, OPTIONS, SEED);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['human', 'computer', 'map-ai', 'absent']);
    const entry = new URLSearchParams(lobbyStartEntry('zatoka', state, lobby, OPTIONS, SEED));
    expect(mapSession(entry, lobby)).toEqual(session);
    expect(lobbySession('zatoka', claimSeat(state, 3), lobby, OPTIONS, SEED).seats[3]?.mode).toBe('absent');
  });

  it('carries a recoloured slot and leaves an authored colour alone', () => {
    const recoloured = setSlotColor(claimSeat(initialRosterState(players), 0), 2, 3);
    expect(recoloured).not.toBeNull();
    const session = lobbySession('zatoka', recoloured ?? initialRosterState(players), players, OPTIONS, SEED);
    expect(session.seats.map((seat) => seat.color)).toEqual([7, 4, 3]);
    expect(
      new URLSearchParams(
        lobbyStartEntry('zatoka', recoloured ?? initialRosterState(players), players, OPTIONS, SEED),
      ).get('colors'),
    ).toBe('2:3');
  });
});

describe('lobby civilization picks', () => {
  const players = [
    slot(0, { claimable: true, type: 'human' }),
    slot(1),
    slot(2, { tribeId: WEREWOLF_TRIBE }),
  ];

  it('carries a chosen civilization from the lobby to the launched session', () => {
    const state = setSlotTribe(initialLobbyState(players), 1, SARACEN);
    const session = lobbySession('zatoka', state, players, OPTIONS, SEED);
    expect(session.seats.map((seat) => seat.tribe)).toEqual([undefined, SARACEN, undefined]);
    const entry = new URLSearchParams(lobbyStartEntry('zatoka', state, players, OPTIONS, SEED));
    expect(entry.get('tribes')).toBe(`1:${SARACEN}`);
    expect(mapSession(entry, players)).toEqual(session);
  });

  it('writes no `?tribes=` while every seat keeps the map’s civilization', () => {
    const state = setSlotTribe(initialLobbyState(players), 1, VIKING);
    expect(lobbySession('zatoka', state, players, OPTIONS, SEED).seats.some((seat) => 'tribe' in seat)).toBe(
      false,
    );
    expect(new URLSearchParams(lobbyStartEntry('zatoka', state, players, OPTIONS, SEED)).has('tribes')).toBe(
      false,
    );
  });

  it('keeps a monster seat its own tribe whatever the state holds', () => {
    const state = setSlotTribe(initialLobbyState(players), 2, SARACEN);
    expect(lobbySession('zatoka', state, players, OPTIONS, SEED).seats[2]?.tribe).toBeUndefined();
  });
});

describe('lobby computer levels', () => {
  const players = [
    slot(0, { claimable: true, type: 'human' }),
    slot(1, { claimable: true }),
    slot(2, { claimable: true, tribeId: WEREWOLF_TRIBE }),
    slot(3),
    slot(4, { hasComputerControl: false }),
    slot(5, { claimable: true, hasComputerControl: false }),
  ];

  it("offers a level on a free seat handed to the computer and on the map's own computer seat, hard until picked, never on a scripted camp", () => {
    const state = initialLobbyState(players);
    // Seat 1 plays as computer, seat 2 is a monster tribe, seat 3 is the map's own computer seat, and
    // Seat 4 is a reserved camp; selectable seat 5 defaults to Computer despite its authored disable.
    expect(lobbySlotRows(players, state).map((row) => row.difficulty)).toEqual([
      null,
      'hard',
      null,
      'hard',
      null,
      'hard',
    ]);
    expect(lobbySlotRows(players, setVacantMode(state, 1, 'idle'))[1]?.difficulty).toBeNull();
  });

  it('carries the picked levels from the lobby to the launched session', () => {
    const state = setSlotDifficulty(setSlotDifficulty(initialLobbyState(players), 1, 'easy'), 3, 'medium');
    const session = lobbySession('zatoka', state, players, OPTIONS, SEED);
    expect(session.seats.map((seat) => seat.difficulty)).toEqual([
      undefined,
      'easy',
      undefined,
      'medium',
      undefined,
      'hard',
    ]);
    const entry = new URLSearchParams(lobbyStartEntry('zatoka', state, players, OPTIONS, SEED));
    expect(entry.get('difficulty')).toBe('1:easy,3:medium,5:hard');
    expect(mapSession(entry, players)).toEqual(session);
  });
});

describe('lobbyStartEntry', () => {
  it('carries the map, the roster choices and explicit game options', () => {
    const players = [slot(0, { claimable: true, type: 'human' }), slot(1, { claimable: true })];
    const state = initialLobbyState(players);
    const params = new URLSearchParams(
      lobbyStartEntry(
        'zatoka',
        state,
        players,
        {
          fog: 'recon-fow',
          professionProgression: false,
          settlerNeeds: false,
          weather: 'map',
          dayNight: 'map',
          alliedVision: false,
          peace: 45,
        },
        SEED,
      ),
    );
    expect(params.get('map')).toBe('zatoka');
    expect(params.get('player')).toBe('0');
    expect(params.get('computer')).toBe('1');
    // The map's own computer seats need no naming: a Forteca-style roster launches with `?computer=` of the
    // offered seats alone, and the session still plays them.
    const forteca = [...players, slot(2), slot(6, { hidden: true })];
    const entry = new URLSearchParams(
      lobbyStartEntry('forteca', initialLobbyState(forteca), forteca, OPTIONS, SEED),
    );
    expect(entry.get('computer')).toBe('1');
    expect(
      lobbySession('forteca', initialLobbyState(forteca), forteca, OPTIONS, SEED).seats.map(
        (seat) => seat.mode,
      ),
    ).toEqual(['human', 'computer', 'map-ai', 'map-ai']);
    expect(params.get('fog')).toBe('recon-fow');
    expect(params.get('progression')).toBe('off');
    expect(params.get('needs')).toBe('off');
    expect(params.get('alliedvision')).toBe('off');
    expect(params.get('weathermode')).toBe('map');
    expect(params.get('daynight')).toBe('map');
    expect(params.get('peace')).toBe('45');
  });

  it('writes the needs and weather defaults explicitly, so a carried choice cannot leak into the next map', () => {
    const players = [slot(0, { claimable: true, type: 'human' })];
    const entry = lobbyStartEntry('zatoka', initialLobbyState(players), players, OPTIONS, SEED);
    expect(new URLSearchParams(entry).get('needs')).toBe('on');
    expect(new URLSearchParams(entry).get('weathermode')).toBe('winter');
  });
});

it('round-trips each offered control mode without changing the human or locked computer', () => {
  const players = [slot(0, { type: 'human', claimable: true }), slot(1, { claimable: true }), slot(2)];
  for (const mode of ['computer', 'idle', 'absent'] as const) {
    const state = setVacantMode(initialLobbyState(players), 1, mode);
    const session = lobbySession('synthetic', state, players, OPTIONS, SEED);
    expect(session.seats.map((seat) => seat.mode)).toEqual(['human', mode, 'map-ai']);
    expect(
      mapSession(new URLSearchParams(lobbyStartEntry('synthetic', state, players, OPTIONS, SEED)), players),
    ).toEqual(session);
  }
});
