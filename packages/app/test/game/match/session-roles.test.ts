import { type GameSession, OBSERVER_SEAT } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import { sessionRoles } from '../../../src/game/match/session-roles.js';
import { mapSession } from '../../../src/game/match/session-url.js';

const ROSTER = [
  { player: 0, colorId: 0, tribeId: 1, type: 'human', claimable: true },
  { player: 1, colorId: 1, tribeId: 1, type: 'human', claimable: true },
  { player: 2, colorId: 2, tribeId: 1, type: 'human', claimable: true },
] as const;

function session(search: string): GameSession {
  return mapSession(new URLSearchParams(search), ROSTER);
}

describe('sessionRoles', () => {
  it('grants the played seat and the AI seats, and matches the seat against the AI', () => {
    expect(sessionRoles(session('map=las&player=1&computer=2'), [])).toEqual({
      machineSeats: [2],
      assistantSeats: [1, 2],
      matchParticipants: [1, 2],
    });
  });

  it('grants nothing to an observer and leaves the match to the AI seats', () => {
    expect(sessionRoles(session(`map=las&player=${OBSERVER_SEAT}&computer=2`), [])).toEqual({
      machineSeats: [2],
      assistantSeats: [2],
      matchParticipants: [2],
    });
  });

  it('matches the map’s own computer seats too, unless the script exempts them', () => {
    // The original's per-tick check counts every seat in use, claimable or not; `playerneverdies`
    // is the only exemption. A scenario seat the lobby never lists therefore has to fall (or be
    // exempt) before the person wins.
    const roster = [...ROSTER, { player: 6, colorId: 9, tribeId: 1, type: 'ai', claimable: false }] as const;
    const scenario = mapSession(new URLSearchParams('map=las&player=0&computer=1'), roster);
    expect(sessionRoles(scenario, []).matchParticipants).toEqual([0, 1, 6]);
    expect(sessionRoles(scenario, [6]).matchParticipants).toEqual([0, 1]);
  });

  it('grants and matches every human seat of a relayed session, whichever is local', () => {
    const relayed: GameSession = {
      world: { kind: 'map', mapId: 'las' },
      seed: 7,
      seats: [
        { player: 0, mode: 'human', color: 0 },
        { player: 1, mode: 'human', color: 1 },
        { player: 2, mode: 'computer', color: 2 },
      ],
      localSeat: 1,
      rules: {
        fog: null,
        progression: null,
        needs: null,
        weather: null,
        dayNight: null,
        alliedVision: null,
        peace: null,
      },
      speed: 1,
    };
    const roles = sessionRoles(relayed, []);
    expect(roles).toEqual({ machineSeats: [2], assistantSeats: [0, 1, 2], matchParticipants: [0, 1, 2] });
    expect(sessionRoles({ ...relayed, localSeat: 0 }, [])).toEqual(roles);
    expect(sessionRoles({ ...relayed, localSeat: OBSERVER_SEAT }, [])).toEqual(roles);
  });
});
