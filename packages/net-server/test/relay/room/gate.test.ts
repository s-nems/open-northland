import { describe, expect, it } from 'vitest';
import { HALL_ARRIVAL_MS, JOIN_PASSWORD_BURST, JOIN_PASSWORD_REFILL_MS } from '../../../src/relay/relay.js';
import {
  type Peer,
  SEATS,
  SETTINGS,
  stage,
  startedRoom,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '../../support/message-stage.js';

const PASSWORD = 'tajne hasło';
const TOKEN_D = 'token-d-0123456789ab';
const HOME = '203.0.113.7';
const ELSEWHERE = '198.51.100.2';

function roomIdOf(peer: Peer): string {
  const id = peer.last('room')?.room.id;
  if (id === undefined) throw new Error('no room');
  return id;
}

describe('room password', () => {
  it('locks a room: a join without or with a wrong password is refused, the right one admitted', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS, password: PASSWORD });
    const roomId = roomIdOf(a);
    b.send({ kind: 'listRooms' });
    expect(b.last('rooms')?.rooms[0]?.locked).toBe(true);
    b.send({ kind: 'joinRoom', roomId });
    expect(b.last('rejected')?.reason).toEqual({ code: 'wrongPassword' });
    b.send({ kind: 'joinRoom', roomId, password: 'inne' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'wrongPassword' });
    b.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    expect(b.last('room')?.room.locked).toBe(true);
    expect(b.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania', 'Bartek']);
    expect(JSON.stringify([...a.sent, ...b.sent])).not.toContain(PASSWORD);
  });

  it('ignores a password sent to an open room', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: roomIdOf(a), password: PASSWORD });
    expect(b.last('room')?.room).toMatchObject({ locked: false, members: [{}, { nick: 'Bartek' }] });
  });

  it('bounds wrong passwords per address, shared by its connections, even before the right one', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek', HOME);
    const twin = s.introduce(TOKEN_C, 'Celina', HOME);
    const other = s.introduce(TOKEN_D, 'Dawid', ELSEWHERE);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS, password: PASSWORD });
    const roomId = roomIdOf(a);
    for (let i = 0; i < JOIN_PASSWORD_BURST; i++) b.send({ kind: 'joinRoom', roomId, password: `${i}` });
    twin.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    expect(twin.last('rejected')?.reason).toEqual({ code: 'retryTooSoon' });
    other.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    expect(other.last('room')).toBeDefined();
    s.advance(JOIN_PASSWORD_REFILL_MS);
    twin.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    expect(twin.last('room')?.room.members).toHaveLength(3);
  });
});

describe('room ban', () => {
  it('is the creator’s, in the lobby, of another member', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: roomIdOf(a) });
    b.send({ kind: 'banMember', nick: 'Ania' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'creatorOnly' });
    a.send({ kind: 'banMember', nick: 'Ania' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'banSelf' });
    a.send({ kind: 'banMember', nick: 'Celina' });
    expect(a.last('rejected')?.reason).toEqual({ code: 'notMember', nick: 'Celina' });

    const started = startedRoom();
    started.a.send({ kind: 'banMember', nick: 'Bartek' });
    expect(started.a.last('rejected')?.reason).toEqual({ code: 'gameStarted' });
  });

  it('removes the member as a leave would, tells it why, and leaves it free in the hall', () => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    const s = stage(true, (event, fields) => events.push([event, fields]));
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek', HOME);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = roomIdOf(a);
    b.send({ kind: 'joinRoom', roomId });
    b.send({ kind: 'claimSeat', player: 1 });
    const before = b.sent.length;
    a.send({ kind: 'banMember', nick: 'Bartek' });
    expect(b.sent.slice(before)).toEqual([{ kind: 'error', reason: { code: 'banned' } }, { kind: 'left' }]);
    expect(a.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania']);
    expect(a.last('room')?.room.seats[1]?.nick).toBeNull();
    expect(events).toContainEqual([
      'room banned',
      { room: roomId, name: SETTINGS.name, by: 'Ania', nick: 'Bartek' },
    ]);

    s.advance(HALL_ARRIVAL_MS);
    expect(b.last('rooms')?.rooms.map((room) => room.id)).toEqual([roomId]);
    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(roomIdOf(b)).not.toBe(roomId);
  });

  it('bars the token and the address, not another address', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek', HOME);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS, password: PASSWORD });
    const roomId = roomIdOf(a);
    b.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    a.send({ kind: 'banMember', nick: 'Bartek' });
    s.relay.disconnect(b.handle);

    const sameToken = s.introduce(TOKEN_B, 'Bartek', ELSEWHERE);
    sameToken.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    expect(sameToken.last('rejected')?.reason).toEqual({ code: 'banned' });
    const sameAddress = s.introduce(TOKEN_C, 'Celina', HOME);
    sameAddress.send({ kind: 'joinRoom', roomId });
    expect(sameAddress.last('rejected')?.reason).toEqual({ code: 'banned' });
    const stranger = s.introduce(TOKEN_D, 'Dawid', ELSEWHERE);
    stranger.send({ kind: 'joinRoom', roomId, password: PASSWORD });
    expect(stranger.last('room')?.room.members).toHaveLength(2);
  });

  it('lets the members inside come back through the banned address, not a newcomer', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania', HOME);
    const b = s.introduce(TOKEN_B, 'Bartek', HOME);
    const c = s.introduce(TOKEN_C, 'Celina', HOME);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = roomIdOf(a);
    b.send({ kind: 'joinRoom', roomId });
    c.send({ kind: 'joinRoom', roomId });
    a.send({ kind: 'banMember', nick: 'Bartek' });

    // A lost link in the lobby is a leave; the household member comes back on its own token.
    s.relay.disconnect(c.handle);
    const returning = s.introduce(TOKEN_C, 'Celina', HOME);
    returning.send({ kind: 'joinRoom', roomId });
    expect(returning.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania', 'Celina']);
    a.send({ kind: 'leaveRoom' });
    a.send({ kind: 'joinRoom', roomId });
    expect(a.last('room')?.room.members.map((member) => member.nick)).toEqual(['Celina', 'Ania']);
    const newcomer = s.introduce(TOKEN_D, 'Dawid', HOME);
    newcomer.send({ kind: 'joinRoom', roomId });
    expect(newcomer.last('rejected')?.reason).toEqual({ code: 'banned' });
  });

  it('outlasts the creator that set it', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Celina');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = roomIdOf(a);
    b.send({ kind: 'joinRoom', roomId });
    c.send({ kind: 'joinRoom', roomId });
    a.send({ kind: 'banMember', nick: 'Celina' });
    a.send({ kind: 'leaveRoom' });
    expect(b.last('room')?.room.creator).toBe('Bartek');
    c.send({ kind: 'joinRoom', roomId });
    expect(c.last('rejected')?.reason).toEqual({ code: 'banned' });
  });
});
