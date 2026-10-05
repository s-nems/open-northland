import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantCountersSeam } from '../src/view/assistant-counters.js';

/** The seam between the assistant window's counters and the sim's `setAssistantCounter` command. */

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
    expect(seam.read().trainSword).toEqual({ value: 0, infinite: false });
    expect(seam.set('trainSword', { value: 2, infinite: false })).toBe(false);
    expect(sent).toEqual([]);
  });

  it("reads the watched seat's counters off the sim block", () => {
    const seam = assistantCountersSeam(
      simCounters({ trainSword: { value: 4, infinite: false }, extraMen: { value: 0, infinite: true } }),
      () => 0,
      () => {},
    );
    const faces = seam.read();
    expect(faces.trainSword).toEqual({ value: 4, infinite: false });
    expect(faces.extraMen).toEqual({ value: 0, infinite: true });
    expect(faces.extraWomen).toEqual(ZERO);
  });

  it('writes one absolute command carrying the seat and the counter', () => {
    const sent: Command[] = [];
    const seam = assistantCountersSeam(
      simCounters(),
      () => 2,
      (c) => sent.push(c),
    );
    expect(seam.set('trainBow', { value: 7, infinite: true })).toBe(true);
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
    expect(seam.set('extraMen', { value: 1, infinite: false })).toBe(false);
    expect(sent).toEqual([]);
  });
});
