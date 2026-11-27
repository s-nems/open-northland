import { describe, expect, it } from 'vitest';
import { type Peer, SEATS, SETTINGS, stage, TOKEN_A, TOKEN_B } from '../../support/message-stage.js';

const TOKEN_C = 'token-c-0123456789ab';

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

  it('shows the refusal in the room view, and a peer without one shows none', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek', undefined, true);
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: roomIdOf(a) });
    expect(a.last('room')?.room.members.find((member) => member.nick === 'Ania')?.noReplay).toBe(undefined);
    expect(a.last('room')?.room.members.find((member) => member.nick === 'Bartek')?.noReplay).toBe(true);
  });
});
