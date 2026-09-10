import { type GameSession, OBSERVER_SEAT, OVERSEER_SEAT } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import { sessionRoles } from '../src/game/session-roles.js';
import { mapSession } from '../src/game/session-url.js';

const ROSTER = [
  { player: 0, colorId: 0 },
  { player: 1, colorId: 1 },
  { player: 2, colorId: 2 },
];

function session(search: string): GameSession {
  return mapSession(new URLSearchParams(search), ROSTER);
}

describe('sessionRoles', () => {
  it('grants the played seat and the AI seats, and matches the seat against the AI', () => {
    expect(sessionRoles(session('map=las&player=1&ai=2'), [])).toEqual({
      aiSeats: [2],
      assistantSeats: [1, 2],
      matchParticipants: [1, 2],
    });
  });

  it('grants nothing to an observer and leaves the match to the AI seats', () => {
    expect(sessionRoles(session(`map=las&player=${OBSERVER_SEAT}&ai=2`), [])).toEqual({
      aiSeats: [2],
      assistantSeats: [2],
      matchParticipants: [2],
    });
  });

  it('keeps the overseer’s default seat granted and out of the match', () => {
    expect(sessionRoles(session(`map=las&player=${OVERSEER_SEAT}&ai=2`), [])).toEqual({
      aiSeats: [2],
      assistantSeats: [0, 2],
      matchParticipants: [2],
    });
  });

  it('grants and matches every human seat of a relayed session, whichever is local', () => {
    const relayed: GameSession = {
      world: { kind: 'map', mapId: 'las' },
      seed: 7,
      seats: [
        { player: 0, mode: 'human', color: 0 },
        { player: 1, mode: 'human', color: 1 },
        { player: 2, mode: 'ai', color: 2 },
      ],
      localSeat: 1,
      rules: { fog: null, progression: null, needs: null },
      speed: 1,
    };
    const roles = sessionRoles(relayed, []);
    expect(roles).toEqual({ aiSeats: [2], assistantSeats: [0, 1, 2], matchParticipants: [0, 1, 2] });
    expect(sessionRoles({ ...relayed, localSeat: 0 }, [])).toEqual(roles);
  });

  it('keeps a never-dies seat out of the match', () => {
    expect(sessionRoles(session('map=las&player=1&ai=2'), [2]).matchParticipants).toEqual([1]);
  });
});
