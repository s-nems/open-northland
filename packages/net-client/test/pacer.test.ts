import { JITTER_BUFFER_TICKS, paceScale } from '@open-northland/net-client';
import { describe, expect, it } from 'vitest';

describe('paceScale', () => {
  it('runs slower than the frames arrive until the buffer holds its target', () => {
    for (let buffered = 0; buffered < JITTER_BUFFER_TICKS; buffered++) {
      expect(paceScale(buffered)).toBeLessThan(1);
    }
  });

  it('runs at the session tempo with the buffer at its target and a frame over', () => {
    expect(paceScale(JITTER_BUFFER_TICKS)).toBe(1);
    expect(paceScale(JITTER_BUFFER_TICKS + 1)).toBe(1);
  });

  it('drains a backlog faster than the frames arrive, the deeper the faster, up to a cap', () => {
    const small = paceScale(JITTER_BUFFER_TICKS + 2);
    const deep = paceScale(60);
    const deeper = paceScale(720);
    expect(small).toBeGreaterThan(1);
    expect(deep).toBeGreaterThan(small);
    expect(deeper).toBeGreaterThanOrEqual(deep);
    expect(paceScale(10_000)).toBe(deeper);
    // Two seconds of frames per second: the whole cache window of five minutes drains inside the
    // kick countdown of a minute.
    expect(deeper).toBeGreaterThanOrEqual(5);
  });
});
