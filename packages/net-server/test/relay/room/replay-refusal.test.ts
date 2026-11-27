import { parseGameSession } from '@open-northland/lockstep';
import { PROTOCOL_VERSION, parseClientMessage, parseServerMessage } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { type Peer, SEATS, SETTINGS, stage, TOKEN_A, TOKEN_B } from '../../support/message-stage.js';

function roomIdOf(peer: Peer): string {
  const id = peer.last('room')?.room.id;
  if (id === undefined) throw new Error('no room');
  return id;
}

/** Two seated, ready members in a room; `refuses` marks the second as a member that says hello
 *  refusing recordings. */
function seatedRoom(refuses: boolean) {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek', undefined, refuses);
  a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  b.send({ kind: 'joinRoom', roomId: roomIdOf(a) });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
  return { ...s, a, b };
}

describe('a member that refuses recordings', () => {
  it("denies the started session's captures for every member of the room", () => {
    const s = seatedRoom(true);
    s.a.send({ kind: 'start' });
    expect(s.b.last('start')?.session.replayCaptures).toBe(false);
    expect(s.a.last('start')?.session.replayCaptures).toBe(false);
  });

  it('follows the refusal the room entry carries, so a changed choice reaches the room it hosts', () => {
    const s = stage();
    // The host's hello refused recordings, its room entry does not: the entry is the newest word.
    const a = s.introduce(TOKEN_A, 'Ania', undefined, true);
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS, noReplay: false });
    b.send({ kind: 'joinRoom', roomId: roomIdOf(a) });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect('replayCaptures' in (b.last('start')?.session ?? {})).toBe(false);
    expect('replayCaptures' in (a.last('start')?.session ?? {})).toBe(false);
  });

  it("turns a refusal a joining member's entry carries into the started session's denial", () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: roomIdOf(a), noReplay: true });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(b.last('start')?.session.replayCaptures).toBe(false);
    expect(a.last('start')?.session.replayCaptures).toBe(false);
  });

  it('leaves a room without a refusal recording, so no field denies anything', () => {
    const s = seatedRoom(false);
    s.a.send({ kind: 'start' });
    expect('replayCaptures' in (s.a.last('start')?.session ?? {})).toBe(false);
  });

  it("follows the choice the member's latest hello carries, even into a room it rejoins", () => {
    const s = seatedRoom(true);
    // The same identity says hello again without the refusal: the room's member takes it.
    s.b = s.introduce(TOKEN_B, 'Bartek', undefined, false);
    expect(s.a.last('room')?.room.members.find((member) => member.nick === 'Bartek')?.noReplay).toBe(
      undefined,
    );
    s.a.send({ kind: 'start' });
    expect('replayCaptures' in (s.b.last('start')?.session ?? {})).toBe(false);
  });

  it('takes a refusal a member tells its room without leaving, and denies the started session', () => {
    const s = seatedRoom(false);
    s.b.send({ kind: 'noReplay', noReplay: true });
    expect(s.a.last('room')?.room.members.find((member) => member.nick === 'Bartek')?.noReplay).toBe(true);
    s.a.send({ kind: 'start' });
    expect(s.b.last('start')?.session.replayCaptures).toBe(false);
    expect(s.a.last('start')?.session.replayCaptures).toBe(false);
  });

  it('takes a retraction a member tells its room, and records the started session', () => {
    const s = seatedRoom(true);
    s.b.send({ kind: 'noReplay', noReplay: false });
    expect(s.a.last('room')?.room.members.find((member) => member.nick === 'Bartek')?.noReplay).toBe(
      undefined,
    );
    s.a.send({ kind: 'start' });
    expect('replayCaptures' in (s.b.last('start')?.session ?? {})).toBe(false);
    expect('replayCaptures' in (s.a.last('start')?.session ?? {})).toBe(false);
  });

  it('shows the refusal in the room view, and a peer without one shows none', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek', undefined, true);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: roomIdOf(a) });
    expect(a.last('room')?.room.members.find((member) => member.nick === 'Ania')?.noReplay).toBe(undefined);
    expect(a.last('room')?.room.members.find((member) => member.nick === 'Bartek')?.noReplay).toBe(true);
  });

  it('keeps the refusal through the real wire transforms on the way in and the session on the way out', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.peer();
    // The refusal chosen before the room, crossing the JSON and parse the relay's socket runs.
    b.send(
      parseClientMessage(
        JSON.parse(
          JSON.stringify({
            kind: 'hello',
            protocol: PROTOCOL_VERSION,
            token: TOKEN_B,
            nick: 'Bartek',
            noReplay: true,
          }),
        ),
      ),
    );
    a.send(
      parseClientMessage(
        JSON.parse(JSON.stringify({ kind: 'createRoom', settings: SETTINGS, seats: SEATS })),
      ),
    );
    b.send(parseClientMessage(JSON.parse(JSON.stringify({ kind: 'joinRoom', roomId: roomIdOf(a) }))));
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    // The started session crosses the link and is read back by the client's own session parse.
    for (const peer of [a, b]) {
      const start = peer.last('start');
      expect(start).toBeDefined();
      const parsed = parseServerMessage(JSON.parse(JSON.stringify(start)), parseGameSession);
      if (parsed.kind !== 'start') throw new Error(`expected start, got ${parsed.kind}`);
      expect(parsed.session.replayCaptures).toBe(false);
    }
  });
});
