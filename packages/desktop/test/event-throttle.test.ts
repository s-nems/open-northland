import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventThrottle } from '../src/event-throttle.js';

/**
 * The shared progress throttle (`src/event-throttle.ts`) that both the pipeline child's item events
 * and the main process's mod events ride. Invariants: at most one ordinary event per 100 ms
 * interval, a `final` event always passes (so a bar never stalls short of its true end), and
 * `reset()` re-opens the gate for a new stage.
 */
describe('createEventThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the first event and drops the rest of the interval', () => {
    const throttle = createEventThrottle();
    expect(throttle.shouldEmit(false)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(throttle.shouldEmit(false)).toBe(false);
    vi.advanceTimersByTime(49);
    expect(throttle.shouldEmit(false)).toBe(false);
  });

  it('re-opens once the interval has elapsed', () => {
    const throttle = createEventThrottle();
    expect(throttle.shouldEmit(false)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(throttle.shouldEmit(false)).toBe(true);
  });

  it('always passes a final event, even mid-interval', () => {
    const throttle = createEventThrottle();
    expect(throttle.shouldEmit(false)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(throttle.shouldEmit(true)).toBe(true);
  });

  it('restarts the interval after a final event', () => {
    const throttle = createEventThrottle();
    throttle.shouldEmit(true);
    vi.advanceTimersByTime(50);
    expect(throttle.shouldEmit(false)).toBe(false);
    vi.advanceTimersByTime(50);
    expect(throttle.shouldEmit(false)).toBe(true);
  });

  it('re-opens the gate on reset, so a new stage never waits out the previous one', () => {
    const throttle = createEventThrottle();
    expect(throttle.shouldEmit(false)).toBe(true);
    vi.advanceTimersByTime(10);
    expect(throttle.shouldEmit(false)).toBe(false);
    throttle.reset();
    expect(throttle.shouldEmit(false)).toBe(true);
  });

  it('gives each throttle its own interval', () => {
    const a = createEventThrottle();
    const b = createEventThrottle();
    expect(a.shouldEmit(false)).toBe(true);
    expect(b.shouldEmit(false)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(a.shouldEmit(false)).toBe(false);
    expect(b.shouldEmit(false)).toBe(false);
  });
});
