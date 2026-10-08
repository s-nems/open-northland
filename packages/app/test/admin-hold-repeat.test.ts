import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHoldRepeat,
  HOLD_REPEAT_DELAY_MS,
  HOLD_REPEAT_INTERVAL_MS,
} from '../src/view/admin-debug/hold-repeat.js';

describe('admin hold repeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet for a press released before the hold delay', () => {
    const repeat = createHoldRepeat();
    const fire = vi.fn();
    repeat.start(fire);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS - 1);
    repeat.stop();
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS * 10);
    expect(fire).not.toHaveBeenCalled();
  });

  it('fires once at the delay and then every interval until stopped', () => {
    const repeat = createHoldRepeat();
    const fire = vi.fn();
    const repeats = 3;
    repeat.start(fire);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS * repeats);
    expect(fire).toHaveBeenCalledTimes(1 + repeats);
    repeat.stop();
    vi.advanceTimersByTime(HOLD_REPEAT_INTERVAL_MS * 10);
    expect(fire).toHaveBeenCalledTimes(1 + repeats);
  });

  it('replaces a running repeat on a new start', () => {
    const repeat = createHoldRepeat();
    const first = vi.fn();
    const second = vi.fn();
    repeat.start(first);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS);
    repeat.start(second);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    repeat.stop();
  });
});
