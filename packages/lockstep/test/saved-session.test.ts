import { describe, expect, it } from 'vitest';
import { createSavedSessionMetadata, type GameSession, parseSavedSessionMetadata } from '../src/index.js';

const descriptor: GameSession = {
  world: { kind: 'map', mapId: 'fixture' },
  seed: 7,
  rules: { fog: 1, progression: false, needs: true },
  speed: 2,
  localSeat: 0,
  kickedSeatMode: 'idle',
  seats: [
    { player: 0, mode: 'human', color: 2, team: 3 },
    { player: 1, mode: 'ai', color: 1, team: null },
  ],
};
const roster = [
  { player: 0, nick: 'Ania' },
  { player: 1, nick: null },
];
describe('persisted session metadata', () => {
  it('preserves empty scene rosters with their default local player', () => {
    const scene = { ...descriptor, world: { kind: 'scene' as const, sceneId: 'sandbox' }, seats: [] };
    expect(createSavedSessionMetadata(scene, []).descriptor).toEqual(scene);
  });
  it('preserves session and display roster with a closed projection excluding tokens and prior save identity', () => {
    const metadata = createSavedSessionMetadata(
      { ...descriptor, initialSave: { tick: 10, fingerprint: 'a'.repeat(64) } },
      roster,
    );
    expect(metadata).toEqual({ version: 1, descriptor, roster });
    const parsed = parseSavedSessionMetadata({
      ...metadata,
      token: 'secret',
      roster: [{ ...roster[0], token: 'secret' }, roster[1]],
      descriptor: { ...descriptor, token: 'secret' },
    });
    expect(parsed).toEqual(metadata);
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(parsed?.descriptor).not.toBe(descriptor);
  });
  it('distinguishes null legacy from malformed or inconsistent saved metadata', () => {
    expect(parseSavedSessionMetadata(null)).toBeNull();
    const valid = createSavedSessionMetadata(descriptor, roster);
    for (const value of [
      undefined,
      {},
      { ...valid, version: 2 },
      { ...valid, roster: [] },
      { ...valid, roster: [roster[1], roster[0]] },
      { ...valid, roster: [roster[0], { player: 1, nick: 'AI' }] },
      { ...valid, descriptor: { ...descriptor, localSeat: 4 } },
    ])
      expect(() => parseSavedSessionMetadata(value)).toThrow();
  });
  it('rejects duplicate or unprintable player names', () => {
    const humans = {
      ...descriptor,
      seats: descriptor.seats.map((seat) => ({ ...seat, mode: 'human' as const })),
    };
    for (const nick of ['Ania', '\n', 'x'.repeat(25), ' padded '])
      expect(() =>
        createSavedSessionMetadata(humans, [
          { player: 0, nick: 'Ania' },
          { player: 1, nick },
        ]),
      ).toThrow();
  });
});
