import type { GameSession } from '@open-northland/lockstep';
import { components, exportSaveGame, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';
import { sessionDiplomacy, sessionSharedVision } from '../src/game/session-teams.js';
import { sessionWorldOptions } from '../src/game/session-world.js';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'synthetic' },
  seed: 7,
  localSeat: 0,
  speed: 1,
  rules: { fog: null, progression: null, needs: null },
  seats: [
    { player: 0, mode: 'human', color: 0, team: 1 },
    { player: 1, mode: 'human', color: 1, team: 1 },
    { player: 2, mode: 'ai', color: 2, team: 2 },
    { player: 3, mode: 'idle', color: 3 },
  ],
};

describe('session teams', () => {
  it('overrides both directions for explicit teams and preserves unassigned map relationships', () => {
    const rows = sessionDiplomacy(SESSION, [
      { from: 0, to: 1, state: 'enemy' },
      { from: 0, to: 3, state: 'friend' },
    ]);
    expect(rows.slice(-6)).toContainEqual({ from: 0, to: 1, state: 'friend' });
    expect(rows).toContainEqual({ from: 1, to: 0, state: 'friend' });
    expect(rows).toContainEqual({ from: 1, to: 2, state: 'enemy' });
    expect(rows.filter((row) => row.to === 3)).toEqual([{ from: 0, to: 3, state: 'friend' }]);
  });

  it('shares vision within each team of two or more, whatever the seat modes', () => {
    expect(sessionSharedVision(SESSION)).toEqual([[0, 1]]);
    expect(
      sessionSharedVision({
        seats: [
          { player: 3, mode: 'ai', color: 3, team: 2 },
          { player: 2, mode: 'human', color: 2, team: 5 },
          { player: 1, mode: 'human', color: 1, team: 2 },
          { player: 0, mode: 'human', color: 0, team: 5 },
        ],
      }),
    ).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('leaves an absent seat out of the match, even where the script names the participants', () => {
    const absent: GameSession = {
      ...SESSION,
      seats: [...SESSION.seats, { player: 4, mode: 'absent', color: 4 }],
    };
    expect(sessionWorldOptions(absent, null, {}).absentSeats).toEqual([4]);
    const scripted = sessionWorldOptions(absent, null, { victory: 'script', participants: [0, 1, 2, 3, 4] });
    expect(scripted.matchParticipants).toEqual([0, 1, 2, 3]);
  });

  it('hands the world its teams as shared vision beside the stances', () => {
    const options = sessionWorldOptions(SESSION, null, {});
    expect(options.sharedVision).toEqual([[0, 1]]);
    expect(options.diplomacy).toContainEqual({ from: 0, to: 2, state: 'enemy' });
  });

  it('produces identical first-tick worlds for two local seats, sharing the team mask', () => {
    const builds = [0, 1].map(
      (localSeat) =>
        buildMapWorld({
          map: { width: 2, height: 2, typeIds: [0, 0, 0, 0] },
          ir: null,
          seed: SESSION.seed,
          content: {},
          aiSeats: [],
          assistantSeats: [],
          ...SESSION.rules,
          diplomacy: sessionDiplomacy({ ...SESSION, localSeat } as GameSession, []),
          sharedVision: sessionSharedVision(SESSION),
        }).sim,
    );
    const [a, b] = builds;
    if (a === undefined || b === undefined) throw new Error('Missing test world');
    a.step();
    b.step();
    expect(serializeSaveGame(exportSaveGame(a))).toBe(serializeSaveGame(exportSaveGame(b)));
    expect(components.diplomacyStance(a.world, 0, 1)).toBe('friend');
    expect(a.fog?.visionGroupOf(1)).toBe(0);
    expect(a.fog?.visionGroupOf(2)).toBe(2);
  });
});
