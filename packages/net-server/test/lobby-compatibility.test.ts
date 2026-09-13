import { type LobbyCompatibility, PROTOCOL_VERSION, type ServerMessage } from '@open-northland/net-protocol';
import type { ClientHandle } from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { SEATS, SETTINGS, stage, TOKEN_A, TOKEN_B, TOKEN_C } from './support/message-stage.js';

function lobby() {
  const s = stage(false);
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  const roomId = a.last('room')?.room.id ?? '';
  b.send({ kind: 'joinRoom', roomId });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  const report = (compatibility: LobbyCompatibility | null = TEST_COMPATIBILITY): void => {
    a.send({ kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
    b.send({ kind: 'setCompatibility', compatibility });
  };
  const ready = (): void => {
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
  };
  const readiness = () =>
    a
      .last('room')
      ?.room.seats.filter((seat) => seat.nick !== null)
      .map((seat) => seat.ready);
  return { ...s, a, b, roomId, report, ready, readiness };
}

describe('lobby compatibility gate', () => {
  it('requires reports before ready and checks them again before start', () => {
    const s = lobby();
    s.ready();
    expect(s.a.last('rejected')?.reason).toBe('Ania: report compatibility missing');
    s.a.send({ kind: 'start' });
    expect(s.a.last('rejected')?.reason).toBe('Ania: report compatibility missing');
    s.report();
    s.ready();
    expect(s.readiness()).toEqual([true, true]);
    s.a.send({ kind: 'start' });
    expect(s.a.last('start')).toBeDefined();
  });

  it.each(['content', 'map', 'client', 'protocol'] as const)('names the member and a %s mismatch', (kind) => {
    const s = lobby();
    const mismatch = {
      ...TEST_COMPATIBILITY,
      [kind]:
        kind === 'protocol' ? PROTOCOL_VERSION + 1 : kind === 'client' ? 'another-client' : 'c'.repeat(64),
    };
    s.report(mismatch);
    s.ready();
    expect(s.readiness()).toEqual([false, false]);
    s.a.send({ kind: 'start' });
    expect(s.a.last('rejected')?.reason).toBe(`Bartek: ${kind} compatibility mismatch`);
    expect(s.b.of('start')).toEqual([]);
  });

  it('names a missing map separately from a mismatched map', () => {
    const s = lobby();
    s.report({ ...TEST_COMPATIBILITY, map: null });
    s.a.send({ kind: 'start' });
    expect(s.a.last('rejected')?.reason).toBe('Bartek: map compatibility missing');
  });

  it('invalidates ready after report changes, and keeps no-op reports and seat claims ready', () => {
    const s = lobby();
    s.report();
    s.ready();
    s.report();
    s.a.send({ kind: 'claimSeat', player: 0 });
    expect(s.readiness()).toEqual([true, true]);
    s.b.send({ kind: 'setCompatibility', compatibility: null });
    expect(s.readiness()).toEqual([false, false]);
    s.a.send({ kind: 'start' });
    expect(s.a.last('rejected')?.reason).toBe('Bartek: report compatibility missing');
    s.report();
    s.a.send({ kind: 'start' });
    expect(s.a.last('rejected')?.reason).toMatch(/not ready/);
  });

  it('invalidates ready after roster changes and when a lobby identity reconnects', () => {
    const s = lobby();
    s.report();
    s.ready();
    const c = s.introduce(TOKEN_C, 'Cezary');
    c.send({ kind: 'joinRoom', roomId: s.roomId });
    expect(s.readiness()).toEqual([false, false]);
    c.send({ kind: 'leaveRoom' });
    s.ready();
    s.b.send({ kind: 'claimSeat', player: 2 });
    expect(s.readiness()).toEqual([false, false]);
    s.ready();
    const back = s.introduce(TOKEN_B, 'Renamed');
    expect(back.last('welcome')?.nick).toBe('Bartek');
    expect(s.readiness()).toEqual([false, false]);
    s.a.send({ kind: 'start' });
    expect(s.a.last('rejected')?.reason).toBe('Bartek: report compatibility missing');
  });

  it('lets only the creator change settings, keeps the world fixed and invalidates ready', () => {
    const s = lobby();
    s.report();
    s.ready();
    const settings = {
      name: SETTINGS.name,
      seed: SETTINGS.seed,
      speed: SETTINGS.speed,
      rules: SETTINGS.rules,
    };
    s.b.send({ kind: 'setSettings', settings: { ...settings, speed: 2 } });
    expect(s.b.last('rejected')?.reason).toMatch(/only the creator/);
    expect(s.readiness()).toEqual([true, true]);
    s.a.send({ kind: 'setSettings', settings });
    expect(s.readiness()).toEqual([true, true]);
    s.a.send({ kind: 'setSettings', settings: { ...settings, seed: 99, speed: 2 } });
    expect(s.readiness()).toEqual([false, false]);
    expect(s.a.last('room')?.room.settings).toEqual({ ...SETTINGS, seed: 99, speed: 2 });
    s.a.send({ kind: 'setSettings', settings: { ...settings, world: { kind: 'map', mapId: 'other' } } });
    expect(s.a.last('rejected')?.reason).toMatch(/immutable/);
    s.ready();
    s.a.send({ kind: 'start' });
    expect(s.b.last('start')?.session).toMatchObject({ seed: 99, speed: 2, world: SETTINGS.world });
    s.b.send({ kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
    expect(s.b.last('rejected')?.reason).toBe('the game has started');
  });

  it('preserves explicit teams in the descriptor and invalidates ready when a team or color changes', () => {
    const s = lobby();
    s.report();
    s.ready();
    s.b.send({ kind: 'setSeat', player: 1, team: 3 });
    expect(s.b.last('rejected')?.reason).toMatch(/only the creator/);
    s.a.send({ kind: 'setSeat', player: 0, team: 3 });
    expect(s.readiness()).toEqual([false, false]);
    s.a.send({ kind: 'setSeat', player: 1, team: 3 });
    s.ready();
    s.a.send({ kind: 'setSeat', player: 0, team: 3 });
    expect(s.readiness()).toEqual([true, true]);
    s.a.send({ kind: 'setSeat', player: 1, color: 5 });
    expect(s.readiness()).toEqual([false, false]);
    s.ready();
    s.a.send({ kind: 'start' });
    expect(s.b.last('start')?.session.seats).toEqual([
      { player: 0, mode: 'human', color: 0, team: 3 },
      { player: 1, mode: 'human', color: 5, team: 3 },
      { player: 2, mode: 'ai', color: 2 },
    ]);
  });

  it('announces a canonical duplicate nick after entering, before synchronous room actions', () => {
    const s = stage(false);
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const messages: ServerMessage[] = [];
    let handle: ClientHandle | null = null;
    let nick = 'Ania';
    handle = s.relay.connect({
      send: (message) => {
        messages.push(message);
        if (message.kind === 'welcome') nick = message.nick;
        if (
          message.kind === 'room' &&
          handle !== null &&
          message.room.members.find((member) => member.nick === nick)?.compatibility === null
        ) {
          s.relay.receive(handle, { kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
        }
      },
      close: () => undefined,
    });
    s.relay.receive(handle, { kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_B, nick: 'Ania' });
    s.relay.receive(handle, { kind: 'joinRoom', roomId: a.last('room')?.room.id });
    expect(nick).toBe('Ania2');
    expect(messages.filter((message) => message.kind === 'rejected')).toEqual([]);
    expect(a.last('room')?.room.members.find((member) => member.nick === 'Ania2')?.compatibility).toEqual(
      TEST_COMPATIBILITY,
    );
  });
});
