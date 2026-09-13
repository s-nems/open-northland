import type { ServerMessage } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';
import { ignoreReconnectRejection, wrongReconnectRoom } from '../../src/entries/relay/reload-message.js';

it('allows only the redundant join rejection after the requested room was auto-restored', () => {
  const rejection = { kind: 'rejected', of: 'joinRoom', reason: 'already in room' } as const;
  expect(ignoreReconnectRejection(rejection, 'room1', 'room1')).toBe(true);
  expect(ignoreReconnectRejection(rejection, 'room1', 'room2')).toBe(false);
  expect(ignoreReconnectRejection(rejection, 'room1', null)).toBe(false);
  expect(ignoreReconnectRejection({ ...rejection, of: 'loaded' }, 'room1', 'room1')).toBe(false);
});
it('rejects auto-restoration to another room before starting its world', () => {
  const message = { kind: 'room', room: { id: 'room2' } } as ServerMessage;
  expect(wrongReconnectRoom(message, 'room1')).toBe(true);
  expect(wrongReconnectRoom(message, 'room2')).toBe(false);
});
