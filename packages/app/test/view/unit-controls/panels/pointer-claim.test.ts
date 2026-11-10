import { describe, expect, it, vi } from 'vitest';
import { claimOncePerTask } from '../../../../src/view/unit-controls/panels/pointer-claim.js';

describe('claimOncePerTask', () => {
  it('asks once for the same point within a task and again in the next', async () => {
    let claimed = true;
    const claim = vi.fn(() => claimed);
    const once = claimOncePerTask(claim);
    expect(once(10, 20)).toBe(true);
    claimed = false;
    expect(once(10, 20)).toBe(true);
    expect(claim).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(once(10, 20)).toBe(false);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('asks again for another point within the same task', () => {
    const claim = vi.fn((x: number) => x > 50);
    const once = claimOncePerTask(claim);
    expect(once(10, 20)).toBe(false);
    expect(once(60, 20)).toBe(true);
    expect(once(10, 20)).toBe(false);
    expect(claim).toHaveBeenCalledTimes(3);
  });
});
