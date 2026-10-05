import type { SyncDigestInputs } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  DISPUTE_RING_BYTES,
  DISPUTE_WINDOW_TICKS,
  DisputeCapture,
  retainedBytes,
} from '../src/dispute-capture.js';

const WORD_BYTES = Uint32Array.BYTES_PER_ELEMENT;
/** Ticks whose words alone fill a quarter of the cap each, so the cap holds three of them. */
const QUARTER_CAP_WORDS = DISPUTE_RING_BYTES / 4 / WORD_BYTES / 2;
const CAPPED_TICKS = 3;

function inputsAt(tick: number, words = 1): SyncDigestInputs {
  return {
    tick,
    rng: tick,
    names: 2166136261,
    nextEntityId: 1,
    entityCount: 1,
    allocations: new Uint32Array(0),
    fog: new Uint32Array(0),
    components: [
      {
        name: 'Position',
        domain: 'movement',
        entities: new Uint32Array(words),
        words: new Uint32Array(words),
      },
    ],
  };
}

function frozenInputs(capture: DisputeCapture, tick: number): number | null {
  capture.freeze('reference', tick, ['movement'], ['Bartek']);
  return capture.record?.inputs?.tick ?? null;
}

describe('dispute capture', () => {
  it('keeps the last window of ticks and records no inputs for a tick before it', () => {
    const capture = new DisputeCapture();
    const last = DISPUTE_WINDOW_TICKS + 1;
    for (let tick = 1; tick <= last; tick++) capture.retain(inputsAt(tick));
    expect(frozenInputs(capture, 1)).toBeNull();
    expect(frozenInputs(capture, 2)).toBe(2);
    expect(frozenInputs(capture, last)).toBe(last);
  });

  it('drops the oldest ticks past the byte cap, and keeps the newest however large', () => {
    const capture = new DisputeCapture();
    expect(retainedBytes(inputsAt(1, QUARTER_CAP_WORDS)) * CAPPED_TICKS).toBeLessThanOrEqual(
      DISPUTE_RING_BYTES,
    );
    expect(retainedBytes(inputsAt(1, QUARTER_CAP_WORDS)) * (CAPPED_TICKS + 1)).toBeGreaterThan(
      DISPUTE_RING_BYTES,
    );
    const last = CAPPED_TICKS + 2;
    for (let tick = 1; tick <= last; tick++) capture.retain(inputsAt(tick, QUARTER_CAP_WORDS));
    expect(frozenInputs(capture, 1)).toBeNull();
    expect(frozenInputs(capture, 2)).toBeNull();
    for (let tick = last - CAPPED_TICKS + 1; tick <= last; tick++)
      expect(frozenInputs(capture, tick)).toBe(tick);

    capture.retain(inputsAt(last + 1, QUARTER_CAP_WORDS * 5));
    expect(frozenInputs(capture, last)).toBeNull();
    expect(frozenInputs(capture, last + 1)).toBe(last + 1);
  });
});
