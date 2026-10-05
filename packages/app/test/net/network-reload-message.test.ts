import type { ServerMessage } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';
import { wrongReconnectRoom } from '../../src/entries/relay/reload-message.js';

it('rejects auto-restoration to another room before starting its world', () => {
  const message = { kind: 'room', room: { id: 'room2' } } as ServerMessage;
  expect(wrongReconnectRoom(message, 'room1')).toBe(true);
  expect(wrongReconnectRoom(message, 'room2')).toBe(false);
});
