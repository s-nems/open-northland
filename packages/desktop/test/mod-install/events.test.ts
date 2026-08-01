import { describe, expect, it } from 'vitest';
import type { ModEvent } from '../../src/ipc.js';
import { isFinalModEvent } from '../../src/mod-install/events.js';

/** Which installer events bypass the progress throttle (`src/mod-install/events.ts`). */
describe('isFinalModEvent', () => {
  it('never throttles a warning away', () => {
    expect(isFinalModEvent({ kind: 'mod-warning', message: 'skipped unsafe zip member' })).toBe(true);
  });

  it('marks the download tick that reaches the announced size', () => {
    expect(isFinalModEvent({ kind: 'mod-download', received: 600, total: 600 })).toBe(true);
    expect(isFinalModEvent({ kind: 'mod-download', received: 599, total: 600 })).toBe(false);
  });

  it('treats an overshoot past the announced size as final too', () => {
    expect(isFinalModEvent({ kind: 'mod-download', received: 601, total: 600 })).toBe(true);
  });

  it('marks no download tick final when the server announced no size', () => {
    expect(isFinalModEvent({ kind: 'mod-download', received: 600 })).toBe(false);
  });

  it('marks the extract tick that writes the last member', () => {
    expect(isFinalModEvent({ kind: 'mod-extract', done: 46_000, total: 46_000 })).toBe(true);
    expect(isFinalModEvent({ kind: 'mod-extract', done: 45_999, total: 46_000 })).toBe(false);
  });

  it('refuses an event kind it was never taught', () => {
    expect(() => isFinalModEvent({ kind: 'mod-verify' } as unknown as ModEvent)).toThrow(
      'unhandled mod event',
    );
  });
});
