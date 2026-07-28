import { describe, expect, it } from 'vitest';
import { selectedWorkFlags } from '../src/view/projections/index.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

/** The flags the renderer highlights for the current selection: one per selected gatherer that planted
 *  one, resolved through the selection rather than the world. */

const gatherer = (id: number, flag: number): Ent => ({ id, components: { WorkFlag: { flag } } });
const idle = (id: number): Ent => ({ id, components: { Settler: { jobType: 8 } } });

const world = snapshotOf([gatherer(1, 101), gatherer(2, 102), idle(3)]);

describe('selectedWorkFlags', () => {
  it('collects one flag per selected gatherer that planted one', () => {
    expect([...selectedWorkFlags(world, new Set([1, 2]))]).toEqual([101, 102]);
  });

  it('skips a selected settler with no flag, and an id the snapshot no longer holds', () => {
    expect([...selectedWorkFlags(world, new Set([1, 3, 99]))]).toEqual([101]);
    expect(selectedWorkFlags(world, new Set()).size).toBe(0);
  });

  it('costs the selection, not the map', () => {
    const crowd = snapshotOf([
      ...Array.from({ length: 4096 }, (_unused, i) => idle(i + 1)),
      gatherer(5000, 777),
    ]);
    const counted = visitCountingSnapshot(crowd);

    expect([...selectedWorkFlags(counted.snapshot, new Set([5000]))]).toEqual([777]);
    // One binary search over 4097 entities; walking the world would hand out every one of them.
    expect(counted.visits()).toBeLessThan(crowd.entities.length / 8);
  });
});
