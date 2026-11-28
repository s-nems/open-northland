import { PROTOCOL_VERSION, type RoomView, type ServerMessage } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeKeepsSeat,
  SURRENDER_TIMEOUT_MS,
  type SurrenderConnection,
  surrenderSeat,
} from '../../../src/entries/relay/seat-surrender.js';
import type { ConnectionEvent } from '../../../src/net/connection.js';

const URL = 'ws://relay.test/';
const IDENTITY = { token: 'token-of-ania', nick: 'Ania' };
const ROOM_ID = 'room1';

/** A connection the test speaks for, recording how it was disposed. */
function fakeConnection() {
  let listener: ((event: ConnectionEvent) => void) | undefined;
  const dispose = vi.fn();
  const joinRoom = vi.fn();
  const connection: SurrenderConnection = {
    client: { joinRoom },
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    dispose,
  };
  const relay = (message: ServerMessage) => listener?.({ kind: 'message', message });
  return { connection, dispose, joinRoom, relay };
}

const roomView = (id: string) => ({ kind: 'room', room: { id } as RoomView }) as ServerMessage;

afterEach(() => vi.useRealTimers());

describe('giving up a seat a halted game left held', () => {
  it('rejoins on the same token and leaves the room once the relay put it back', async () => {
    const fake = fakeConnection();
    const done = surrenderSeat(URL, IDENTITY, ROOM_ID, () => fake.connection);
    fake.relay({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
    expect(fake.joinRoom).toHaveBeenCalledWith(ROOM_ID);
    fake.relay({ kind: 'rejected', of: 'joinRoom', reason: { code: 'alreadyInRoom' } });
    expect(fake.dispose).not.toHaveBeenCalled();
    fake.relay(roomView(ROOM_ID));
    await done;
    expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('leaves nothing when the room went on without it', async () => {
    const fake = fakeConnection();
    const done = surrenderSeat(URL, IDENTITY, ROOM_ID, () => fake.connection);
    fake.relay({ kind: 'rejected', of: 'joinRoom', reason: { code: 'gameStarted' } });
    await done;
    expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('never leaves another room the token was put back into', async () => {
    const fake = fakeConnection();
    const done = surrenderSeat(URL, IDENTITY, ROOM_ID, () => fake.connection);
    fake.relay(roomView('room2'));
    await done;
    expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('gives up waiting on a relay that does not answer', async () => {
    vi.useFakeTimers();
    const fake = fakeConnection();
    const done = surrenderSeat(URL, IDENTITY, ROOM_ID, () => fake.connection);
    vi.advanceTimersByTime(SURRENDER_TIMEOUT_MS);
    await done;
    expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(false);
  });
});

it('offers no seat back after a takeover or a relay shutdown, but does after other final closes', () => {
  expect(closeKeepsSeat('replaced')).toBe(false);
  expect(closeKeepsSeat('serverRestart')).toBe(false);
  expect(closeKeepsSeat('malformed')).toBe(true);
  expect(closeKeepsSeat(undefined)).toBe(true);
});
