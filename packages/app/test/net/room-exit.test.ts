import { describe, expect, it } from 'vitest';
import { roomExitObserver } from '../../src/entries/relay/room-exit.js';

describe('room termination', () => {
  it('ends the view with the relay reason even though the socket stays connected', () => {
    const exits: Array<string | null> = [];
    const observe = roomExitObserver((reason) => exits.push(reason));
    expect(observe({ kind: 'error', reason: 'snapshot unavailable' })).toBe(false);
    expect(exits).toEqual([]);
    expect(observe({ kind: 'left' })).toBe(true);
    expect(exits).toEqual(['snapshot unavailable']);
  });

  it('does not reuse an earlier error as the reason for a later departure', () => {
    const exits: Array<string | null> = [];
    const observe = roomExitObserver((reason) => exits.push(reason));
    observe({ kind: 'error', reason: 'unrelated' });
    observe({ kind: 'chat', from: 'Ania', text: 'hello' });
    observe({ kind: 'left' });
    expect(exits).toEqual([null]);
  });
});
