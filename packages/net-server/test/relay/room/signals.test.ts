import { SIGNAL_BURST, SIGNAL_REFILL_MS } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';
import { roomOfThree, SEATS, SETTINGS, stage, TOKEN_A } from '../../support/message-stage.js';

const AT = { hx: 40, hy: 72 };

it('delivers a signal to the seats it names alone, stamped with the sender', () => {
  const s = roomOfThree();
  s.a.send({ kind: 'signal', at: AT, to: [1] });
  expect(s.b.of('signal')).toEqual([{ kind: 'signal', from: 'Ania', seat: 0, at: AT }]);
  expect(s.c.of('signal')).toEqual([]);
  expect(s.a.of('signal')).toEqual([]);
});

it('drops the signals past a member’s allowance until it refills', () => {
  const s = roomOfThree();
  for (let i = 0; i < SIGNAL_BURST + 2; i++) s.a.send({ kind: 'signal', at: AT, to: [1] });
  expect(s.b.of('signal')).toHaveLength(SIGNAL_BURST);
  expect(s.a.of('rejected')).toEqual([]);
  s.advance(SIGNAL_REFILL_MS);
  s.a.send({ kind: 'signal', at: AT, to: [1] });
  expect(s.b.of('signal')).toHaveLength(SIGNAL_BURST + 1);
});

it('refuses a signal before the start and from an observer', () => {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  a.send({ kind: 'signal', at: AT, to: [1] });
  expect(a.last('rejected')?.reason).toEqual({ code: 'gameNotStarted' });
  const room = roomOfThree();
  room.b.send({ kind: 'claimSeat', player: null });
  room.b.send({ kind: 'signal', at: AT, to: [0] });
  expect(room.b.last('rejected')?.reason).toEqual({ code: 'seatRequired' });
  expect(room.a.of('signal')).toEqual([]);
});
