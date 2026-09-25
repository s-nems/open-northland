import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantCountersSeam } from '../src/view/assistant-counters.js';

/** The seam translating the six chest-window counter rows to `setAssistantCounter` commands and
 *  back - the three class rows renamed onto the sim's weapon-class kinds. */

const ZERO = { value: 0, infinite: false };

function simCounters(overrides: Partial<Record<string, { value: number; infinite: boolean }>> = {}) {
  return {
    assistantCounters: () => ({
      extraWomen: ZERO,
      extraMen: ZERO,
      trainSoldiers: ZERO,
      trainSword: ZERO,
      trainSpear: ZERO,
      trainBow: ZERO,
      ...overrides,
    }),
  };
}

describe('assistantCountersSeam', () => {
  it('reads every counter as zero and writes nothing while no seat is watched', () => {
    const sent: Command[] = [];
    const seam = assistantCountersSeam(
      simCounters({ trainSword: { value: 4, infinite: true } }),
      () => null,
      (c) => sent.push(c),
    );
    expect(seam.read().trainSwordsmen).toEqual({ value: 0, infinite: false });
    expect(seam.set('trainSwordsmen', 2, false)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('reads the six rows off the sim block, the class rows renamed', () => {
    const seam = assistantCountersSeam(
      simCounters({ trainSword: { value: 4, infinite: false }, extraMen: { value: 0, infinite: true } }),
      () => 0,
      () => {},
    );
    const faces = seam.read();
    expect(faces.trainSwordsmen).toEqual({ value: 4, infinite: false });
    expect(faces.extraMen).toEqual({ value: 0, infinite: true });
    expect(faces.extraWomen).toEqual(ZERO);
  });

  it('writes one absolute command carrying the seat and the sim kind', () => {
    const sent: Command[] = [];
    const seam = assistantCountersSeam(
      simCounters(),
      () => 2,
      (c) => sent.push(c),
    );
    expect(seam.set('trainArchers', 7, true)).toBe(true);
    expect(sent).toEqual([
      { kind: 'setAssistantCounter', player: 2, counter: 'trainBow', value: 7, infinite: true },
    ]);
  });

  it('a read-only session rejects every write', () => {
    const sent: Command[] = [];
    const seam = assistantCountersSeam(
      simCounters(),
      () => 0,
      (c) => sent.push(c),
      false,
    );
    expect(seam.set('extraMen', 1, false)).toBe(false);
    expect(sent).toEqual([]);
  });
});
