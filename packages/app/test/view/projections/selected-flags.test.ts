import { describe, expect, it } from 'vitest';
import { selectedFlags } from '../../../src/view/projections/index.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from '../../support/snapshot.js';

/** The flags the renderer highlights for the current selection: one per selected gatherer that planted
 *  one, resolved through the selection rather than the world. */

const gatherer = (id: number, flag: number): Ent => ({ id, components: { WorkFlag: { flag } } });
const idle = (id: number): Ent => ({ id, components: { Settler: { jobType: 8 } } });

const world = snapshotOf([gatherer(1, 101), gatherer(2, 102), idle(3)]);

describe('selectedFlags', () => {
  it('collects one flag per selected gatherer that planted one', () => {
    expect([...selectedFlags(world, new Set([1, 2]))]).toEqual([101, 102]);
  });

  it('skips a selected settler with no flag, and an id the snapshot no longer holds', () => {
    expect([...selectedFlags(world, new Set([1, 3, 99]))]).toEqual([101]);
    expect(selectedFlags(world, new Set()).size).toBe(0);
  });

  it('adds the wall or road site a selected builder claimed, not one it only works on', () => {
    const BUILDER = 10;
    const ROAD_SITE = 201;
    const WALL = 202;
    const builderAt = (site: number): Ent => ({ id: BUILDER, components: { SiteAssignment: { site } } });
    const claimed = (id: number, component: 'RoadSite' | 'Palisade', builder: number | null): Ent => ({
      id,
      components: { [component]: { reservation: builder === null ? null : { builder } } },
    });
    const road = snapshotOf([builderAt(ROAD_SITE), claimed(ROAD_SITE, 'RoadSite', BUILDER)]);
    expect([...selectedFlags(road, new Set([BUILDER]))]).toEqual([ROAD_SITE]);
    const wall = snapshotOf([builderAt(WALL), claimed(WALL, 'Palisade', BUILDER)]);
    expect([...selectedFlags(wall, new Set([BUILDER]))]).toEqual([WALL]);
    const open = snapshotOf([builderAt(WALL), claimed(WALL, 'Palisade', null)]);
    expect(selectedFlags(open, new Set([BUILDER])).size).toBe(0);
  });

  it('costs the selection, not the map', () => {
    const crowd = snapshotOf([
      ...Array.from({ length: 4096 }, (_unused, i) => idle(i + 1)),
      gatherer(5000, 777),
    ]);
    const counted = visitCountingSnapshot(crowd);

    expect([...selectedFlags(counted.snapshot, new Set([5000]))]).toEqual([777]);
    // One binary search over 4097 entities; walking the world would hand out every one of them.
    expect(counted.visits()).toBeLessThan(crowd.entities.length / 8);
  });
});
