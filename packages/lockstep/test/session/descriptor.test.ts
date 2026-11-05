import { describe, expect, it } from 'vitest';
import {
  DAY_NIGHT_MODES,
  type GameSession,
  humanSeatsOf,
  isReadOnlySpectator,
  isSpectator,
  machineSeatsOf,
  orderedSeats,
  PEACE_MINUTES,
  parseGameSession,
  seatColourOf,
  WEATHER_MODES,
} from '../../src/index.js';

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
      { player: 1, mode: 'computer', color: 4 },
      { player: 2, mode: 'idle', color: 9 },
    ],
    localSeat: 0,
    rules: {
      fog: 1,
      progression: true,
      needs: null,
      weather: 'map',
      dayNight: null,
      alliedVision: null,
      peace: null,
    },
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

  it('round-trips the fallback map while requiring a scene name', () => {
    const fallback = session({ world: { kind: 'map', mapId: '' } });
    expect(roundTrip(fallback)).toEqual(fallback);
    expect(() => roundTrip(session({ world: { kind: 'scene', sceneId: '' } }))).toThrow(/world.sceneId/);
    for (const mapId of ['map\nname', '\u0000']) {
      expect(() => roundTrip(session({ world: { kind: 'map', mapId } }))).toThrow(/world.mapId/);
    }
  });

  it('carries a map variant and refuses one without a map', () => {
    const variant = session({ world: { kind: 'map', mapId: 'specjalna_forteca', variant: 'ragnarok' } });
    expect(roundTrip(variant)).toEqual(variant);
    expect(() => roundTrip(session({ world: { kind: 'map', mapId: '', variant: 'ragnarok' } }))).toThrow(
      /world.variant/,
    );
    expect(() => roundTrip(session({ world: { kind: 'map', mapId: 'zatoka', variant: '' } }))).toThrow(
      /world.variant/,
    );
  });

  it('preserves a chosen civilization and omits it when the map keeps its own', () => {
    const configured = session({
      seats: [
        { player: 0, mode: 'human', color: 0, tribe: 4 },
        { player: 1, mode: 'computer', color: 1 },
      ],
    });
    expect(roundTrip(configured)).toEqual(configured);
    expect(roundTrip(configured).seats[1]).not.toHaveProperty('tribe');
    for (const tribe of [0, -1, 1.5, '4', null]) {
      expect(() =>
        parseGameSession({ ...session(), seats: [{ player: 0, mode: 'human', color: 0, tribe }] }),
      ).toThrow(/tribe/);
    }
  });

  it('preserves a computer seat’s level and refuses one on any other seat', () => {
    const configured = session({
      seats: [
        { player: 0, mode: 'human', color: 0 },
        { player: 1, mode: 'computer', color: 1, difficulty: 'easy' },
      ],
    });
    expect(roundTrip(configured)).toEqual(configured);
    expect(() =>
      parseGameSession({ ...session(), seats: [{ player: 0, mode: 'human', color: 0, difficulty: 'easy' }] }),
    ).toThrow(/difficulty/);
    expect(() =>
      parseGameSession({
        ...session(),
        seats: [{ player: 0, mode: 'computer', color: 0, difficulty: 'brutal' }],
      }),
    ).toThrow(/difficulty/);
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
          { player: 1, mode: 'computer', color: 0 },
          { player: 1, mode: 'idle', color: 1 },
        ],
      }),
    ).toThrow(/ascending/);
    expect(() =>
      parseGameSession({ ...session(), seats: [{ player: 0, mode: 'human', color: -1 }] }),
    ).toThrow(/negative colour/);
    expect(() => parseGameSession({ ...session(), rules: { fog: 'classic' } })).toThrow(/rules.fog/);
  });

  it('rejects unsafe integers and undefined fog modes', () => {
    expect(() => parseGameSession(session({ seed: 1e30 }))).toThrow(/seed/);
    expect(() =>
      parseGameSession(
        session({
          rules: {
            fog: 9,
            progression: null,
            needs: null,
            weather: null,
            dayNight: null,
            alliedVision: null,
            peace: null,
          },
        }),
      ),
    ).toThrow(/rules.fog/);
  });

  it('reads every day and night mode and null, and refuses an unknown or missing one', () => {
    const rules = { fog: null, progression: null, needs: null, weather: null };
    for (const dayNight of [...DAY_NIGHT_MODES, null]) {
      const full = { ...rules, dayNight, alliedVision: null, peace: null };
      expect(roundTrip(session({ rules: full })).rules.dayNight).toBe(dayNight);
    }
    expect(() => parseGameSession({ ...session(), rules: { ...rules, dayNight: 'dusk' } })).toThrow(
      /rules.dayNight/,
    );
    expect(() => parseGameSession({ ...session(), rules })).toThrow(/rules.dayNight/);
  });

  it('reads every weather mode and null, and refuses an unknown or missing one', () => {
    for (const weather of [...WEATHER_MODES, null]) {
      const rules = {
        fog: null,
        progression: null,
        needs: null,
        weather,
        dayNight: null,
        alliedVision: null,
        peace: null,
      };
      expect(roundTrip(session({ rules })).rules.weather).toBe(weather);
    }
    const rules = { fog: null, progression: null, needs: null };
    expect(() => parseGameSession({ ...session(), rules: { ...rules, weather: 'rain' } })).toThrow(
      /rules.weather/,
    );
    expect(() => parseGameSession({ ...session(), rules })).toThrow(/rules.weather/);
  });

  it('reads every peace length and null, and refuses a length the lobby does not offer', () => {
    for (const peace of [...PEACE_MINUTES, null]) {
      const rules = {
        fog: null,
        progression: null,
        needs: null,
        weather: null,
        dayNight: null,
        alliedVision: null,
        peace,
      };
      expect(roundTrip(session({ rules })).rules.peace).toBe(peace);
    }
    const rules = {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
    };
    expect(() => parseGameSession({ ...session(), rules: { ...rules, peace: 50 } })).toThrow(/rules.peace/);
    expect(() => parseGameSession({ ...session(), rules })).toThrow(/rules.peace/);
  });

  it('reads the roster the way the entry consumes it', () => {
    const colourOf = seatColourOf(session());
    expect(colourOf(1)).toBe(4);
    expect(colourOf(5)).toBe(5); // off-roster keeps its slot id
    expect(seatColourOf(session({ seats: [] }))(3)).toBe(3);
    expect(machineSeatsOf(session())).toEqual([1]);
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
        { player: 1, mode: 'computer', color: 1 },
        { player: 2, mode: 'idle', color: 2 },
        { player: 5, mode: 'human', color: 5 },
      ],
    });
    expect(humanSeatsOf(roster)).toEqual([0, 5]);
    expect(machineSeatsOf(roster)).toEqual([1]);
  });
});
