import type { GameSession } from '@open-northland/lockstep';
import { components, exportSaveGame, serializeSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';
import { sessionDiplomacy } from '../src/game/session-diplomacy.js';

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

  it('produces identical first-tick worlds for two local seats', () => {
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
        }).sim,
    );
    const [a, b] = builds;
    if (a === undefined || b === undefined) throw new Error('Missing test world');
    a.step();
    b.step();
    expect(serializeSaveGame(exportSaveGame(a))).toBe(serializeSaveGame(exportSaveGame(b)));
    expect(components.diplomacyStance(a.world, 0, 1)).toBe('friend');
  });
});
