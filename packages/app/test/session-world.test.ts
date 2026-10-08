import type { MapDiplomacy } from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';
import { components, FOG_MODE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';
import { sessionWorldOptions } from '../src/game/session-world.js';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'synthetic' },
  seed: 7,
  localSeat: 0,
  speed: 1,
  rules: { fog: FOG_MODE.CLASSIC, progression: null, needs: null, weather: null, alliedVision: true },
  seats: [
    { player: 0, mode: 'human', color: 0 },
    { player: 1, mode: 'human', color: 1 },
    { player: 2, mode: 'ai', color: 2 },
    { player: 3, mode: 'idle', color: 3 },
  ],
};

/** Players 0 and 1 allied by the map, both hostile to 2. */
const AUTHORED: readonly MapDiplomacy[] = [
  { from: 0, to: 1, state: 'friend' },
  { from: 1, to: 0, state: 'friend' },
  { from: 0, to: 2, state: 'enemy' },
];

describe('session world options', () => {
  it('leaves an absent seat out of the match, even where the script names the participants', () => {
    const absent: GameSession = {
      ...SESSION,
      seats: [...SESSION.seats, { player: 4, mode: 'absent', color: 4 }],
    };
    expect(sessionWorldOptions(absent, null, {}).absentSeats).toEqual([4]);
    const scripted = sessionWorldOptions(absent, null, { victory: 'script', participants: [0, 1, 2, 3, 4] });
    expect(scripted.matchParticipants).toEqual([0, 1, 2, 3]);
  });

  it('hands the world the rules, allied vision among them', () => {
    expect(sessionWorldOptions(SESSION, null, {}).alliedVision).toBe(true);
  });

  it('joins the map allies into one fog mask under the rule', () => {
    const { sim } = buildMapWorld({
      map: { width: 2, height: 2, typeIds: [0, 0, 0, 0] },
      ir: null,
      seed: SESSION.seed,
      content: {},
      aiSeats: [],
      assistantSeats: [],
      ...SESSION.rules,
      diplomacy: AUTHORED,
    });
    sim.step();
    expect(components.diplomacyStance(sim.world, 0, 1)).toBe('friend');
    expect(sim.fog?.visionGroupOf(1)).toBe(0);
    expect(sim.fog?.visionGroupOf(2)).toBe(2);
  });
});
