import { FOG_MODE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_SEED,
  mapSession,
  type SessionRosterSlot,
  sceneSession,
  sessionSearch,
} from '../src/game/session-url.js';

/**
 * The URL is one carrier of a session descriptor. These pin what each `?map=` parameter means and
 * that a launch URL and the descriptor it launches describe the same game.
 */

const ROSTER: readonly SessionRosterSlot[] = [
  { player: 0, colorId: 7, type: 'human', claimable: true },
  { player: 1, colorId: 4, type: 'human', claimable: true },
  { player: 2, colorId: 9, type: 'ai', claimable: true },
];

/** A Forteca-style roster: three seats a person may take, then the map's own computer seats. */
const SCENARIO_ROSTER: readonly SessionRosterSlot[] = [
  ...ROSTER,
  { player: 3, colorId: 3, type: 'ai', claimable: false },
  { player: 6, colorId: 9, type: 'ai', claimable: false },
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
    expect(parsed.rules).toEqual({ fog: FOG_MODE.RECON_FOG_OF_WAR, progression: null, needs: false });
    expect(parsed.speed).toBe(2);
  });

  it('falls back to the default seat, seed and tempo when nothing usable names them', () => {
    const parsed = session('map=zatoka&player=99&seed=-1&speed=abc');
    expect(parsed.localSeat).toBe(0);
    expect(parsed.seed).toBe(DEFAULT_SESSION_SEED);
    expect(parsed.speed).toBe(1);
    expect(parsed.rules).toEqual({ fog: null, progression: null, needs: null });
  });

  it('reads both spectator seats, which play no roster seat', () => {
    expect(session('map=zatoka&player=observer').localSeat).toBe('observer');
    expect(session('map=zatoka&player=overseer').localSeat).toBe('overseer');
  });

  it('gives each seat its mode and its colour, the claimed seat winning over `?ai=`', () => {
    expect(session('map=zatoka&player=1&ai=1,2').seats).toEqual([
      { player: 0, mode: 'idle', color: 7 },
      { player: 1, mode: 'human', color: 4 },
      { player: 2, mode: 'ai', color: 9 },
    ]);
  });

  it('plays the map’s own computer seats whatever `?ai=` lists, the claimed one excepted', () => {
    // A seat nobody may take is a `PLAYER_TYPE_AI` seat in every game the original runs, so a
    // lobby-written `?ai=1,2` or a hand-typed URL that never names it still runs its handlers.
    const modes = (search: string) =>
      mapSession(new URLSearchParams(search), SCENARIO_ROSTER).seats.map((seat) => [seat.player, seat.mode]);
    expect(modes('map=forteca&player=0&ai=1,2')).toEqual([
      [0, 'human'],
      [1, 'ai'],
      [2, 'ai'],
      [3, 'ai'],
      [6, 'ai'],
    ]);
    expect(modes('map=forteca&player=6')).toEqual([
      [0, 'idle'],
      [1, 'idle'],
      [2, 'idle'],
      [3, 'ai'],
      [6, 'human'],
    ]);
  });

  it('overrides authored colours and drops a pair no consumer could render', () => {
    // An out-of-range colour renders differently per consumer (the sprite LUT clamps, the minimap
    // wraps, the signpost atlas misses), so it keeps the authored one instead.
    const parsed = session('map=zatoka&colors=0:3,x:1,1:-2,2:99');
    expect(parsed.seats.map((seat) => seat.color)).toEqual([3, 4, 9]);
  });

  it('still plays the seats a map without a roster names, keeping the slot id as the colour', () => {
    // A map that ships no `.script.json` used to lose `?ai=` entirely once the roster became the
    // only source of seats.
    expect(mapSession(new URLSearchParams('map=zatoka&player=1&ai=2&colors=3:5'), []).seats).toEqual([
      { player: 1, mode: 'human', color: 1 },
      { player: 2, mode: 'ai', color: 2 },
      { player: 3, mode: 'idle', color: 5 },
    ]);
  });

  it('lists seats in ascending order however the map or the search wrote them', () => {
    // World assembly enqueues one setup command per AI seat in this order, so it cannot be left to the
    // order a roster was authored in or a `?ai=` list was typed in.
    const shuffled: readonly SessionRosterSlot[] = [
      { player: 2, colorId: 9, type: 'human', claimable: true },
      { player: 0, colorId: 7, type: 'human', claimable: true },
    ];
    expect(mapSession(new URLSearchParams('map=zatoka'), shuffled).seats.map((s) => s.player)).toEqual([
      0, 2,
    ]);
    const typed = mapSession(new URLSearchParams('map=zatoka&player=0&ai=2,1'), ROSTER);
    expect(typed.seats.filter((s) => s.mode === 'ai').map((s) => s.player)).toEqual([1, 2]);
  });
});

describe('sceneSession', () => {
  it('carries the scene, its own seed, and only the rules the URL overrides', () => {
    const parsed = sceneSession(new URLSearchParams('scene=sandbox&progression=off'), 'sandbox', 11);
    expect(parsed.world).toEqual({ kind: 'scene', sceneId: 'sandbox' });
    expect(parsed.seed).toBe(11);
    expect(parsed.seats).toEqual([]);
    expect(parsed.rules).toEqual({ fog: null, progression: false, needs: null });
  });
});

describe('sessionSearch', () => {
  it('round-trips every parameter a session carries', () => {
    const search =
      'map=magiczny_las&player=2&seed=42&colors=0:3&ai=1&fog=recon-fow&progression=off&needs=on&speed=1.5';
    const parsed = session(search);
    expect(mapSession(sessionSearch(parsed, ROSTER), ROSTER)).toEqual(parsed);
  });

  it('writes only what the person chose, and always the seat', () => {
    const parsed = session('map=zatoka');
    expect(sessionSearch(parsed, ROSTER).toString()).toBe('map=zatoka&player=0');
  });

  it('leaves the map’s own computer seats out of `?ai=`, which lists the person’s choices', () => {
    const parsed = mapSession(new URLSearchParams('map=forteca&player=0&ai=2'), SCENARIO_ROSTER);
    expect(parsed.seats.filter((seat) => seat.mode === 'ai').map((seat) => seat.player)).toEqual([2, 3, 6]);
    const search = sessionSearch(parsed, SCENARIO_ROSTER);
    expect(search.toString()).toBe('map=forteca&player=0&ai=2');
    expect(mapSession(search, SCENARIO_ROSTER)).toEqual(parsed);
  });

  it('names a scene without a roster of its own', () => {
    const parsed = sceneSession(new URLSearchParams('needs=off'), 'sandbox', 11);
    expect(sessionSearch(parsed).toString()).toBe('scene=sandbox&needs=off');
  });
});
