import { describe, expect, it } from 'vitest';
import {
  aiSeatsOf,
  type GameSession,
  humanSeatsOf,
  isReadOnlySpectator,
  isSpectator,
  orderedSeats,
  parseGameSession,
  seatColourOf,
} from '../src/index.js';

/**
 * The descriptor is what a relay broadcasts and a menu builds a world from, so it has to survive a
 * JSON round trip unchanged and refuse anything that would assemble a different world in silence.
 */

function session(over: Partial<GameSession> = {}): GameSession {
  return {
    world: { kind: 'map', mapId: 'magiczny_las' },
    seed: 7,
    seats: [
      { player: 0, mode: 'human', color: 7 },
      { player: 1, mode: 'ai', color: 4 },
      { player: 2, mode: 'idle', color: 9 },
    ],
    localSeat: 0,
    rules: { fog: 1, progression: true, needs: null },
    speed: 1,
    ...over,
  };
}

function roundTrip(value: GameSession): GameSession {
  return parseGameSession(JSON.parse(JSON.stringify(value)));
}

describe('game session descriptor', () => {
  it('survives a plain JSON round trip', () => {
    expect(roundTrip(session())).toEqual(session());
    const scene = session({ world: { kind: 'scene', sceneId: 'sandbox' }, seats: [] });
    expect(roundTrip(scene)).toEqual(scene);
    const overseer = session({ localSeat: 'overseer' });
    expect(roundTrip(overseer)).toEqual(overseer);
  });

  it('holds the roster to the ascending order world assembly follows', () => {
    const shuffled = [
      { player: 2, mode: 'idle', color: 9 },
      { player: 0, mode: 'human', color: 7 },
    ] as const;
    expect(orderedSeats(shuffled).map((seat) => seat.player)).toEqual([0, 2]);
    expect(() => parseGameSession(session({ seats: shuffled }))).toThrow(/ascending/);
  });

  it('preserves explicit teams and the map-authored diplomacy default', () => {
    const configured = session({
      seats: [
        { player: 0, mode: 'human', color: 7, team: 0 },
        { player: 1, mode: 'human', color: 4, team: 0 },
        { player: 2, mode: 'ai', color: 9, team: null },
      ],
    });
    expect(roundTrip(configured)).toEqual(configured);
    expect(roundTrip(session()).seats[0]).not.toHaveProperty('team');
    for (const team of [-1, 17, 1.5, '1', false]) {
      expect(() =>
        parseGameSession({
          ...session(),
          seats: [{ player: 0, mode: 'human', color: 0, team }],
        }),
      ).toThrow(/team/);
    }
  });

  it('refuses a payload that would assemble a different world', () => {
    expect(() => parseGameSession(session({ seed: 1.5 }))).toThrow(/seed/);
    expect(() => parseGameSession(session({ speed: 0 }))).toThrow(/speed/);
    expect(() => parseGameSession({ ...session(), world: { kind: 'lobby' } })).toThrow(/world.kind/);
    expect(() => parseGameSession({ ...session(), localSeat: 'spectator' })).toThrow(/localSeat/);
    expect(() => parseGameSession({ ...session(), seats: [{ player: 0, mode: 'robot', color: 0 }] })).toThrow(
      /seat mode/,
    );
    expect(() =>
      parseGameSession({
        ...session(),
        seats: [
          { player: 1, mode: 'ai', color: 0 },
          { player: 1, mode: 'idle', color: 1 },
        ],
      }),
    ).toThrow(/ascending/);
    expect(() =>
      parseGameSession({ ...session(), seats: [{ player: 0, mode: 'human', color: -1 }] }),
    ).toThrow(/negative colour/);
    expect(() => parseGameSession({ ...session(), rules: { fog: 'reveal' } })).toThrow(/rules.fog/);
  });

  it('rejects unsafe integers and undefined fog modes', () => {
    expect(() => parseGameSession(session({ seed: 1e30 }))).toThrow(/seed/);
    expect(() => parseGameSession(session({ rules: { fog: 3, progression: null, needs: null } }))).toThrow(
      /rules.fog/,
    );
  });

  it('reads the roster the way the entry consumes it', () => {
    const colourOf = seatColourOf(session());
    expect(colourOf(1)).toBe(4);
    expect(colourOf(5)).toBe(5); // off-roster keeps its slot id
    expect(seatColourOf(session({ seats: [] }))(3)).toBe(3);
    expect(aiSeatsOf(session())).toEqual([1]);
  });

  it('tells the two spectator seats apart', () => {
    expect(isSpectator(session({ localSeat: 'observer' }))).toBe(true);
    expect(isReadOnlySpectator(session({ localSeat: 'observer' }))).toBe(true);
    expect(isSpectator(session({ localSeat: 'overseer' }))).toBe(true);
    expect(isReadOnlySpectator(session({ localSeat: 'overseer' }))).toBe(false);
    expect(isSpectator(session())).toBe(false);
  });
});

describe('roster queries', () => {
  it('split the seats by who plays them', () => {
    const roster = session({
      seats: [
        { player: 0, mode: 'human', color: 0 },
        { player: 1, mode: 'ai', color: 1 },
        { player: 2, mode: 'idle', color: 2 },
        { player: 5, mode: 'human', color: 5 },
      ],
    });
    expect(humanSeatsOf(roster)).toEqual([0, 5]);
    expect(aiSeatsOf(roster)).toEqual([1]);
  });
});
