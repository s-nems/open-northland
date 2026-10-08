import { createHash } from 'node:crypto';
import type { RoomSeatSetup } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { SETTINGS, stage, TOKEN_A, TOKEN_B, TOKEN_C } from './support/message-stage.js';

const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
const EGYPT = 7;
const WEREWOLF = 6;

/** Two civilization seats, a monster seat and a seat of a world without a roster. */
const TRIBE_SEATS: readonly RoomSeatSetup[] = [
  { player: 0, mode: 'idle', offers: ['idle', 'ai'], color: 0, authoredTribe: VIKING },
  { player: 1, mode: 'idle', offers: ['idle', 'ai'], color: 1, authoredTribe: FRANK },
  { player: 2, mode: 'ai', offers: ['ai'], color: 2, authoredTribe: WEREWOLF },
  { player: 3, mode: 'ai', offers: ['ai'], color: 3 },
];

function lobby(seats: readonly RoomSeatSetup[] = TRIBE_SEATS, settings = SETTINGS) {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  const c = s.introduce(TOKEN_C, 'Cezary');
  a.send({ kind: 'createRoom', settings, seats });
  const roomId = a.last('room')?.room.id;
  b.send({ kind: 'joinRoom', roomId });
  c.send({ kind: 'joinRoom', roomId });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  const seat = (player: number) => a.last('room')?.room.seats.find((view) => view.player === player);
  const readiness = () => a.last('room')?.room.seats.map((view) => view.ready);
  return { ...s, a, b, c, seat, readiness };
}

describe('seat tribes in the lobby', () => {
  it('shows every member the authored tribe beside the current one, and none on a seat without it', () => {
    const { c, a, seat } = lobby();
    expect(seat(0)).toMatchObject({ authoredTribe: VIKING, tribe: VIKING });
    expect(seat(2)).toMatchObject({ authoredTribe: WEREWOLF, tribe: WEREWOLF });
    expect(seat(3)).not.toHaveProperty('authoredTribe');
    expect(seat(3)).not.toHaveProperty('tribe');
    expect(c.last('room')?.room.seats).toEqual(a.last('room')?.room.seats);
  });

  it('lets the creator set any seat’s tribe and clears every ready flag when it changes', () => {
    const { a, b, seat, readiness } = lobby();
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'setSeat', player: 1, tribe: EGYPT });
    expect(seat(1)).toMatchObject({ authoredTribe: FRANK, tribe: EGYPT });
    expect(readiness()).toEqual([false, false, false, false]);
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'setSeat', player: 1, tribe: EGYPT });
    expect(readiness()).toEqual([true, true, false, false]);
  });

  it('lets a seated member set its own seat’s tribe alone, and nothing else', () => {
    const { b, c, seat } = lobby();
    b.send({ kind: 'setSeat', player: 1, tribe: BYZANTINE });
    expect(seat(1)?.tribe).toBe(BYZANTINE);
    b.send({ kind: 'setSeat', player: 0, tribe: BYZANTINE });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    b.send({ kind: 'setSeat', player: 1, tribe: VIKING, color: 5 });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    c.send({ kind: 'setSeat', player: 1, tribe: VIKING });
    expect(c.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    expect(seat(1)).toMatchObject({ tribe: BYZANTINE, color: 1 });
  });

  it('refuses a tribe on a seat that names none, without applying the rest of the change', () => {
    const { a, seat } = lobby();
    a.send({ kind: 'setSeat', player: 3, color: 7, tribe: VIKING });
    expect(a.last('rejected')?.reason).toEqual({ code: 'seatTribeUnavailable', player: 3 });
    expect(seat(3)?.color).toBe(3);
  });

  it('carries a tribe on the start descriptor only where it differs from the map’s', () => {
    const { a, b, c } = lobby();
    a.send({ kind: 'setSeat', player: 0, tribe: FRANK });
    a.send({ kind: 'setSeat', player: 1, tribe: EGYPT });
    a.send({ kind: 'setSeat', player: 1, tribe: FRANK });
    c.send({ kind: 'claimSeat', player: 2 });
    for (const peer of [a, b, c]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(b.last('start')?.session.seats).toEqual([
      { player: 0, mode: 'human', color: 0, tribe: FRANK },
      { player: 1, mode: 'human', color: 1 },
      { player: 2, mode: 'human', color: 2 },
      { player: 3, mode: 'ai', color: 3 },
    ]);
    b.send({ kind: 'setSeat', player: 1, tribe: VIKING });
    expect(b.last('rejected')?.reason).toEqual({ code: 'gameStarted' });
  });
});

describe('seat tribes in a room resumed from a save', () => {
  const bytes = Buffer.from('opaque save').toString('base64');
  const identity = { fingerprint: createHash('sha256').update(bytes).digest('hex'), tick: 73 };
  const savedSeats: readonly RoomSeatSetup[] = [
    { player: 0, mode: 'idle', offers: ['idle', 'ai'], color: 0, authoredTribe: VIKING, tribe: EGYPT },
    { player: 1, mode: 'idle', offers: ['idle', 'ai'], color: 1, authoredTribe: FRANK },
  ];

  it('keeps the saved tribes: none may change, and the start carries them', () => {
    const { a, b, c, seat } = lobby(savedSeats, { ...SETTINGS, initialSave: identity });
    c.send({ kind: 'leaveRoom' });
    expect(seat(0)).toMatchObject({ authoredTribe: VIKING, tribe: EGYPT });
    a.send({ kind: 'setSeat', player: 1, tribe: VIKING });
    expect(a.last('rejected')?.reason).toEqual({ code: 'savedSeatsFixed' });
    b.send({ kind: 'setSeat', player: 1, tribe: VIKING });
    expect(b.last('rejected')?.reason).toEqual({ code: 'savedSeatsFixed' });
    a.send({ kind: 'blob', type: 'initialSave', to: null, tick: identity.tick, bytes });
    for (const peer of [a, b])
      peer.send({
        kind: 'setCompatibility',
        compatibility: { ...TEST_COMPATIBILITY, save: identity.fingerprint },
      });
    for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('start')?.session.seats).toEqual([
      { player: 0, mode: 'human', color: 0, tribe: EGYPT },
      { player: 1, mode: 'human', color: 1 },
    ]);
  });
});
