import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR } from '../src/game/sandbox/ids/index.js';
import { assignableJobAt } from '../src/view/unit-controls/assign-highlight.js';

/**
 * The capacity-and-offer half of the assign-workplace highlight (the green/red verdict). The full sim
 * gate (tribe/owner/tech/XP) runs in `assignWorker`; this pure predicate decides what the wash shows —
 * a building with an open slot the settler's assignment priority would take is green.
 */

const MILL_SLOTS = [
  { jobType: 19, count: 2 }, // miller
  { jobType: JOB_CARRIER, count: 1 },
];
const WAREHOUSE_SLOTS = [
  { jobType: JOB_CARRIER, count: 3 },
  { jobType: JOB_COLLECTOR, count: 3 },
  { jobType: 15, count: 3 }, // hunter (a gatherer slot)
];

describe('assignableJobAt — the green/red verdict', () => {
  it('greenlights a mill for a plain settler via its carrier slot when a seat is free', () => {
    // No one bound yet: the default order (miller → carrier) finds the miller slot open first.
    expect(assignableJobAt(undefined, MILL_SLOTS, undefined)).toBe(19);
  });

  it('reds out a building whose every offered slot is full', () => {
    const full = new Map<number, number>([
      [19, 2],
      [JOB_CARRIER, 1],
    ]);
    expect(assignableJobAt(undefined, MILL_SLOTS, full)).toBeNull();
  });

  it('falls through a full craft slot to the carrier fallback', () => {
    const millerFull = new Map<number, number>([[19, 2]]);
    expect(assignableJobAt(undefined, MILL_SLOTS, millerFull)).toBe(JOB_CARRIER);
  });

  it('offers a gatherer its own gatherer slot at a warehouse (its current trade)', () => {
    // A hunter (a gatherer) prefers the warehouse's gatherer slots, its own hunter slot first.
    expect(assignableJobAt(15, WAREHOUSE_SLOTS, undefined)).toBe(15);
  });

  it('never offers a plain settler a warehouse gatherer slot — only its carrier', () => {
    // A jobless/plain settler is a carrier at a warehouse, never a gatherer (the default excludes them).
    expect(assignableJobAt(undefined, WAREHOUSE_SLOTS, undefined)).toBe(JOB_CARRIER);
  });

  it('reds out a building that employs nobody', () => {
    expect(assignableJobAt(undefined, undefined, undefined)).toBeNull();
    expect(assignableJobAt(undefined, [], undefined)).toBeNull();
  });
});
