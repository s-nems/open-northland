import { describe, expect, it } from 'vitest';
import { createRingVeil } from '../src/view/unit-controls/ring-veil.js';

/** The settler panel veiled by a ring opened from it, with every veil call recorded. */
function harness() {
  const calls: boolean[] = [];
  let ringUp = false;
  const veil = createRingVeil({ veil: (on) => calls.push(on) }, () => ringUp);
  return {
    calls,
    veil,
    setRing(up: boolean): void {
      ringUp = up;
    },
  };
}

describe('the panel veiled for a ring opened from it', () => {
  it('stays veiled while the ring is up and comes back on the first frame after it closed', () => {
    const { calls, veil, setRing } = harness();
    setRing(true);
    veil.raise();
    veil.refresh();
    veil.refresh();
    expect(calls).toEqual([true]);
    // A pressed order, Space or Escape closes the ring without touching the selection.
    setRing(false);
    veil.refresh();
    veil.refresh();
    expect(calls).toEqual([true, false]);
  });

  it('never unveils a panel it did not veil', () => {
    const { calls, veil } = harness();
    veil.refresh();
    expect(calls).toEqual([]);
  });
});
