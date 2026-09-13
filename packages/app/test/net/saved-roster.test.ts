import { createSavedSessionMetadata, type GameSession } from '@open-northland/lockstep';
import { exportSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { restoreSavedSeats, savedRoster } from '../../src/entries/main-menu/network/saved-roster.js';
import { runDemoWorld } from '../../src/game/world/index.js';

const descriptor: GameSession = {
  world: { kind: 'map', mapId: 'test' },
  seed: 7,
  localSeat: 0,
  speed: 2,
  rules: { fog: null, progression: null, needs: null },
  seats: [
    { player: 0, mode: 'human', color: 3, team: 1 },
    { player: 1, mode: 'ai', color: 4 },
  ],
};
const authored = [
  { player: 0, mode: 'idle' as const, color: 0 },
  { player: 1, mode: 'idle' as const, color: 1 },
];
const metadata = createSavedSessionMetadata(descriptor, [
  { player: 0, nick: 'Ania' },
  { player: 1, nick: null },
]);
const save = exportSaveGame(runDemoWorld(7, 0), { mapId: 'test', session: metadata });

describe('saved multiplayer roster', () => {
  it('recovers colors, teams and AI, leaving saved humans free for an explicit claim', () => {
    expect(restoreSavedSeats(save, authored)).toEqual([
      { player: 0, mode: 'idle', color: 3, team: 1 },
      { player: 1, mode: 'ai', color: 4 },
    ]);
    expect(savedRoster(save)?.roster[0]?.nick).toBe('Ania');
  });
  it('preserves the legacy fallback and distinguishes absent metadata from corrupt metadata', () => {
    expect(restoreSavedSeats({ ...save, header: { ...save.header, session: null } }, authored)).toEqual(
      authored,
    );
    expect(() => savedRoster({ ...save, header: { ...save.header, session: {} } })).toThrow();
  });
  it('rejects a saved descriptor naming a different map, seed or roster', () => {
    expect(() => savedRoster({ ...save, header: { ...save.header, mapId: 'other' } })).toThrow(/world/);
    expect(() => savedRoster({ ...save, header: { ...save.header, seed: 8 } })).toThrow(/world/);
    expect(() => restoreSavedSeats(save, authored.slice(0, 1))).toThrow(/roster/);
  });
});
