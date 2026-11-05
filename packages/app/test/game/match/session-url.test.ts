import { isReadOnlySpectator } from '@open-northland/lockstep';
import { FOG_MODE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  mapSession,
  replaySearch,
  type SessionRosterSlot,
  sceneSession,
  sessionSearch,
} from '../../../src/game/match/session-url.js';

/**
 * The URL is one carrier of a session descriptor. These pin what each `?map=` parameter means and
 * that a launch URL and the descriptor it launches describe the same game.
 */

/** `TRIBE_TYPE_HUMAN_*` codes the rosters below name. */
const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
const SARACEN = 4;

const ROSTER: readonly SessionRosterSlot[] = [
  { player: 0, colorId: 7, tribeId: VIKING, type: 'human', claimable: true },
  { player: 1, colorId: 4, tribeId: FRANK, type: 'human', claimable: true },
  { player: 2, colorId: 9, tribeId: SARACEN, type: 'ai', claimable: true },
];

/** A Forteca-style roster: three seats a person may take, then the map's own computer seats. */
const SCENARIO_ROSTER: readonly SessionRosterSlot[] = [
  ...ROSTER,
  { player: 3, colorId: 3, tribeId: VIKING, type: 'ai', claimable: false },
  { player: 6, colorId: 9, tribeId: VIKING, type: 'ai', claimable: false },
];

function session(search: string) {
  return mapSession(new URLSearchParams(search), ROSTER);
}

describe('mapSession', () => {
  it('reads the world, the seat, the seed, the rules and the tempo', () => {
    const parsed = session('map=magiczny_las&player=1&seed=42&fog=recon-fow&needs=off&speed=2');
    expect(parsed.world).toEqual({ kind: 'map', mapId: 'magiczny_las' });
    expect(parsed.localSeat).toBe(1);
    expect(parsed.seed).toBe(42);
    expect(parsed.rules).toEqual({
      fog: FOG_MODE.RECON_FOG_OF_WAR,
      progression: null,
      needs: false,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    });
    expect(parsed.speed).toBe(2);
  });

  it('falls back to the default seat and tempo and draws a seed when nothing usable names them', () => {
    const parsed = session('map=zatoka&player=99&seed=-1&speed=abc');
    expect(parsed.localSeat).toBe(0);
    expect(Number.isInteger(parsed.seed)).toBe(true);
    expect(parsed.seed).toBeGreaterThanOrEqual(0);
    expect(new Set([1, 2, 3, 4].map(() => session('map=zatoka').seed)).size).toBeGreaterThan(1);
    expect(parsed.speed).toBe(1);
    expect(parsed.rules).toEqual({
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    });
  });

  it('reads both spectator seats, which play no roster seat', () => {
    expect(session('map=zatoka&player=observer').localSeat).toBe('observer');
    expect(session('map=zatoka&player=overseer').localSeat).toBe('overseer');
  });

  it('gives each seat its mode and its colour, the claimed seat winning over `?computer=`', () => {
    expect(session('map=zatoka&player=1&computer=1,2').seats).toEqual([
      { player: 0, mode: 'idle', color: 7 },
      { player: 1, mode: 'human', color: 4 },
      { player: 2, mode: 'computer', color: 9 },
    ]);
  });

  it('plays the map’s own computer seats whatever the URL lists, without allowing a claim on them', () => {
    // A seat nobody may take is a `PLAYER_TYPE_AI` seat in every game the original runs, so a
    // lobby-written `?computer=1,2` or a hand-typed URL that never names it still runs its handlers.
    const modes = (search: string) =>
      mapSession(new URLSearchParams(search), SCENARIO_ROSTER).seats.map((seat) => [seat.player, seat.mode]);
    expect(modes('map=forteca&player=0&computer=1,2')).toEqual([
      [0, 'human'],
      [1, 'computer'],
      [2, 'computer'],
      [3, 'map-ai'],
      [6, 'map-ai'],
    ]);
    const reserved = mapSession(new URLSearchParams('map=forteca&player=6'), SCENARIO_ROSTER);
    expect(reserved.localSeat).toBe('observer');
    expect(isReadOnlySpectator(reserved)).toBe(true);
    expect(modes('map=forteca&player=6')).toEqual([
      [0, 'idle'],
      [1, 'idle'],
      [2, 'computer'],
      [3, 'map-ai'],
      [6, 'map-ai'],
    ]);
  });

  it('cannot select map AI for an open slot through the URL', () => {
    const result = session('map=zatoka&player=0&map-ai=1,12');
    expect(result.seats.map((seat) => [seat.player, seat.mode])).toEqual([
      [0, 'human'],
      [1, 'idle'],
      [2, 'computer'],
    ]);
    expect(sessionSearch(result, ROSTER).has('map-ai')).toBe(false);
  });

  it.each(['computer', 'absent'])('cannot select a forbidden %s mode through the URL', (mode) => {
    const roster = ROSTER.map((slot) => ({ ...slot, aiAllowed: false, noneAllowed: false }));
    const parsed = mapSession(new URLSearchParams(`map=zatoka&player=observer&${mode}=0,1,2`), roster);
    expect(parsed.seats.map((seat) => seat.mode)).toEqual(['idle', 'idle', 'idle']);
  });

  it('overrides authored colours and drops a pair no consumer could render', () => {
    // An out-of-range colour renders differently per consumer (the sprite LUT clamps, the minimap
    // wraps, the signpost atlas misses), so it keeps the authored one instead.
    const parsed = session('map=zatoka&colors=0:3,x:1,1:-2,2:99');
    expect(parsed.seats.map((seat) => seat.color)).toEqual([3, 4, 9]);
  });

  it('still plays the seats a map without a roster names, keeping the slot id as the colour', () => {
    // A map that ships no `.script.json` used to lose `?computer=` entirely once the roster became the
    // only source of seats.
    expect(mapSession(new URLSearchParams('map=zatoka&player=1&computer=2&colors=3:5'), []).seats).toEqual([
      { player: 1, mode: 'human', color: 1 },
      { player: 2, mode: 'computer', color: 2 },
      { player: 3, mode: 'idle', color: 5 },
    ]);
  });

  it('lists seats in ascending order however the map or the search wrote them', () => {
    // World assembly enqueues one setup command per AI seat in this order, so it cannot be left to the
    // order a roster was authored in or a `?computer=` list was typed in.
    const shuffled: readonly SessionRosterSlot[] = [
      { player: 2, colorId: 9, tribeId: VIKING, type: 'human', claimable: true },
      { player: 0, colorId: 7, tribeId: VIKING, type: 'human', claimable: true },
    ];
    expect(mapSession(new URLSearchParams('map=zatoka'), shuffled).seats.map((s) => s.player)).toEqual([
      0, 2,
    ]);
    const typed = mapSession(new URLSearchParams('map=zatoka&player=0&computer=2,1'), ROSTER);
    expect(typed.seats.filter((s) => s.mode === 'computer').map((s) => s.player)).toEqual([1, 2]);
  });
});

describe('sceneSession', () => {
  it('carries the scene, its own seed, and only the rules the URL overrides', () => {
    const parsed = sceneSession(new URLSearchParams('scene=sandbox&progression=off'), 'sandbox', 11);
    expect(parsed.world).toEqual({ kind: 'scene', sceneId: 'sandbox' });
    expect(parsed.seed).toBe(11);
    expect(parsed.seats).toEqual([]);
    expect(parsed.rules).toEqual({
      fog: null,
      progression: false,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    });
  });
});

describe('sessionSearch', () => {
  it('round-trips every parameter a session carries', () => {
    const search = `map=magiczny_las&player=2&seed=42&colors=0:3&tribes=1:${BYZANTINE}&difficulty=1:easy&computer=1&fog=recon-fow&progression=off&needs=on&weathermode=winter&speed=1.5`;
    const parsed = session(search);
    expect(mapSession(sessionSearch(parsed, ROSTER), ROSTER)).toEqual(parsed);
  });

  it('round-trips a map variant and drops one the map does not ship', () => {
    const ragnarok = session('map=specjalna_forteca&variant=ragnarok&seed=3');
    expect(ragnarok.world).toEqual({ kind: 'map', mapId: 'specjalna_forteca', variant: 'ragnarok' });
    expect(sessionSearch(ragnarok, ROSTER).get('variant')).toBe('ragnarok');
    expect(mapSession(sessionSearch(ragnarok, ROSTER), ROSTER)).toEqual(ragnarok);
    expect(session('map=zatoka&variant=ragnarok&seed=3').world).toEqual({ kind: 'map', mapId: 'zatoka' });
    expect(session('map=specjalna_forteca&variant=nope&seed=3').world).toEqual({
      kind: 'map',
      mapId: 'specjalna_forteca',
    });
  });

  it('writes only what the person chose, and always the seat and the seed', () => {
    const parsed = session('map=zatoka&seed=9');
    expect(sessionSearch(parsed, ROSTER).toString()).toBe('map=zatoka&player=0&computer=2&seed=9');
  });

  it('names only the seats played as another civilization than the roster gives them', () => {
    const parsed = session(`map=zatoka&tribes=0:${BYZANTINE},1:${FRANK}`);
    expect(parsed.seats.map((seat) => seat.tribe)).toEqual([BYZANTINE, FRANK, undefined]);
    const search = sessionSearch(parsed, ROSTER);
    expect(search.get('tribes')).toBe(`0:${BYZANTINE}`);
    expect(sessionSearch(session('map=zatoka'), ROSTER).has('tribes')).toBe(false);
  });

  it('gives a level only to a computer seat, and drops one it cannot read', () => {
    const parsed = session('map=zatoka&player=0&computer=2&difficulty=1:easy,2:hard,0:hard,2:brutal');
    expect(parsed.seats.map((seat) => seat.difficulty)).toEqual([undefined, undefined, 'hard']);
  });

  it('leaves the map’s own computer seats out of `?computer=`, which lists the person’s choices', () => {
    const parsed = mapSession(new URLSearchParams('map=forteca&player=0&computer=2&seed=9'), SCENARIO_ROSTER);
    expect(parsed.seats.filter((seat) => seat.mode === 'computer').map((seat) => seat.player)).toEqual([2]);
    const search = sessionSearch(parsed, SCENARIO_ROSTER);
    expect(search.toString()).toBe('map=forteca&player=0&computer=2&seed=9');
    expect(mapSession(search, SCENARIO_ROSTER)).toEqual(parsed);
  });

  it('round-trips the absent seats, which never outrank the claimed seat or an AI one', () => {
    const parsed = session('map=zatoka&player=0&computer=2&absent=0,1,2');
    expect(parsed.seats.map((seat) => seat.mode)).toEqual(['human', 'absent', 'computer']);
    const search = sessionSearch(parsed, ROSTER);
    expect(search.get('absent')).toBe('1');
    expect(mapSession(search, ROSTER)).toEqual(parsed);
  });

  it('names a scene without a roster of its own', () => {
    const parsed = sceneSession(new URLSearchParams('needs=off'), 'sandbox', 11);
    expect(sessionSearch(parsed).toString()).toBe('scene=sandbox&needs=off');
  });

  it('carries the weather mode, and writes none when the session has no choice of its own', () => {
    const parsed = session('map=zatoka&weathermode=map');
    expect(parsed.rules.weather).toBe('map');
    expect(sessionSearch(parsed, ROSTER).get('weathermode')).toBe('map');
    expect(session('map=zatoka&weathermode=rain').rules.weather).toBeNull();
    expect(sessionSearch(session('map=zatoka'), ROSTER).has('weathermode')).toBe(false);
    expect(sessionSearch(session('map=zatoka&daynight=on'), ROSTER).get('daynight')).toBe('on');
    expect(session('map=zatoka&daynight=dusk').rules.dayNight).toBeNull();
    expect(sessionSearch(session('map=zatoka'), ROSTER).has('daynight')).toBe(false);
  });
});

describe('replaySearch', () => {
  it('keeps the world, the seats and the settings, and drops the seed for the entry to draw anew', () => {
    const params = new URLSearchParams('map=zatoka&player=1&computer=2&seed=42&fog=explored&lang=pl');
    const replay = replaySearch(params);
    expect(replay).toBe('?map=zatoka&player=1&computer=2&fog=explored&lang=pl');
    expect(params.get('seed')).toBe('42');
    const replayed = session(replay.slice(1));
    expect({ ...replayed, seed: 0 }).toEqual({ ...session(params.toString()), seed: 0 });
  });
});
