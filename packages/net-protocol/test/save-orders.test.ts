import { describe, expect, it } from 'vitest';
import { MAX_SAVE_ORDERS_BYTES, parseClientMessage, parseServerMessage } from '../src/index.js';

const command = {
  sequence: 0,
  envelope: { v: 1, origin: 'player', player: 0, command: { kind: 'moveUnit', entity: 1, x: 2, y: 3 } },
};
const response = {
  kind: 'saveOrders',
  id: 2,
  tick: 5,
  frames: [
    { tick: 7, commands: [command] },
    { tick: 12, commands: [command] },
  ],
};
const parse = (value: unknown) =>
  parseServerMessage(value, () => {
    throw new Error('unexpected descriptor');
  });
describe('saved accepted order wire contract', () => {
  it('preserves rejection correlation and refuses malformed request ids', () => {
    const rejection = { kind: 'rejected', of: 'saveOrders', reason: 'stale', requestId: 7 };
    expect(parse(rejection)).toEqual(rejection);
    for (const requestId of [-1, 0.5, null, '7', Number.MAX_SAFE_INTEGER + 1])
      expect(() => parse({ ...rejection, requestId })).toThrow();
  });
  it('round-trips counts and sparse future frames, including an empty capture', () => {
    expect(parseClientMessage({ kind: 'saveOrders', id: 2, tick: 5, world: 3 })).toEqual({
      kind: 'saveOrders',
      id: 2,
      tick: 5,
      world: 3,
    });
    expect(parse(response)).toEqual(response);
    expect(parse({ ...response, frames: [] })).toEqual({ ...response, frames: [] });
  });
  it('rejects invalid counts, wrong frame order, empty frames and command sequence gaps', () => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => parseClientMessage({ kind: 'saveOrders', id: value, tick: 5, world: 3 })).toThrow();
    for (const frames of [
      [{ tick: 5, commands: [command] }],
      [
        { tick: 7, commands: [command] },
        { tick: 6, commands: [command] },
      ],
      [{ tick: 7, commands: [] }],
      [{ tick: 7, commands: [{ ...command, sequence: 1 }] }],
    ])
      expect(() => parse({ ...response, frames })).toThrow();
  });
  it('enforces the serialized response budget before parsing large opaque payloads', () => {
    expect(() =>
      parse({
        ...response,
        frames: [
          {
            tick: 7,
            commands: [
              {
                ...command,
                envelope: {
                  ...command.envelope,
                  command: { kind: 'opaque', data: 'x'.repeat(Math.floor(MAX_SAVE_ORDERS_BYTES / 3)) },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(/byte budget/);
  });
});
