import type { RoomSeatSetup } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SETTINGS, stage, TOKEN_A, TOKEN_B } from './support/message-stage.js';

/** A seat a person may take, a free seat the computer plays at a level, and the map's own camp. */
const LEVEL_SEATS: readonly RoomSeatSetup[] = [
  { player: 0, mode: 'idle', offers: ['idle', 'ai'], color: 0, difficulty: 'medium' },
  { player: 1, mode: 'ai', offers: ['idle', 'ai'], color: 1, difficulty: 'medium' },
  { player: 2, mode: 'ai', offers: ['ai'], color: 2 },
];

function lobby(settings = SETTINGS) {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({ kind: 'createRoom', settings, seats: LEVEL_SEATS });
  b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
  a.send({ kind: 'claimSeat', player: 0 });
  const seat = (player: number) => b.last('room')?.room.seats.find((view) => view.player === player);
  return { a, b, seat };
}

describe('computer seat levels in the lobby', () => {
  it('lets the creator set a seat’s level, and refuses it elsewhere', () => {
    const { a, b, seat } = lobby();
    a.send({ kind: 'setSeat', player: 1, difficulty: 'easy' });
    expect(seat(1)?.difficulty).toBe('easy');
    b.send({ kind: 'setSeat', player: 1, difficulty: 'hard' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ kind: 'setSeat', player: 2, difficulty: 'hard' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'seatDifficultyUnavailable', player: 2 });
    expect(seat(2)).not.toHaveProperty('difficulty');
  });

  it('carries a level on the start descriptor only for a seat the computer plays', () => {
    const { a, b } = lobby();
    a.send({ kind: 'setSeat', player: 1, difficulty: 'easy' });
    b.send({ kind: 'leaveRoom' });
    a.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('start')?.session.seats).toEqual([
      { player: 0, mode: 'human', color: 0 },
      { player: 1, mode: 'ai', color: 1, difficulty: 'easy' },
      { player: 2, mode: 'ai', color: 2 },
    ]);
  });

  it('keeps a saved room’s levels', () => {
    const { a } = lobby({ ...SETTINGS, initialSave: { fingerprint: 'a'.repeat(64), tick: 73 } });
    a.send({ kind: 'setSeat', player: 1, difficulty: 'easy' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'savedSeatsFixed' });
  });
});
