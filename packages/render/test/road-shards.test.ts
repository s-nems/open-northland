import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { RoadShardTracker } from '../src/data/scene/index.js';

const NETWORK_ID = 1;
const WEST_SHARD_ID = 2;
const EAST_SHARD_ID = 3;
const WEST_BLOCK = 0;
const EAST_BLOCK = 1;

interface ShardValue {
  readonly block: number;
  readonly nodes: readonly number[];
  readonly revision: number;
}

/** A snapshot holding the network's counter and the given shards, carried by fixed ids. */
function snapshotOf(revision: number, shards: ReadonlyMap<number, ShardValue>): WorldSnapshot {
  const entities: EntitySnapshot[] = [{ id: NETWORK_ID, components: { RoadNetwork: { revision } } }];
  for (const [id, shard] of shards) entities.push({ id, components: { RoadShard: shard } });
  return { tick: 0, entities, events: [] };
}

describe('RoadShardTracker', () => {
  it('reports the nodes each changed shard gained, and nothing while the counter holds', () => {
    const tracker = new RoadShardTracker();
    const west = { block: WEST_BLOCK, nodes: [10, 11], revision: 1 };
    const first = snapshotOf(1, new Map([[WEST_SHARD_ID, west]]));
    expect(tracker.update(first)).toEqual({ added: [10, 11], removed: [] });
    expect(tracker.update(first)).toBeNull();
    const grown = { block: WEST_BLOCK, nodes: [10, 11, 12], revision: 2 };
    const east = { block: EAST_BLOCK, nodes: [200], revision: 1 };
    const second = snapshotOf(
      3,
      new Map([
        [WEST_SHARD_ID, grown],
        [EAST_SHARD_ID, east],
      ]),
    );
    expect(tracker.update(second)).toEqual({ added: [12, 200], removed: [] });
  });

  it('diffs a shard that lost nodes, and lifts every node of a shard that left', () => {
    const tracker = new RoadShardTracker();
    tracker.update(
      snapshotOf(
        1,
        new Map([
          [WEST_SHARD_ID, { block: WEST_BLOCK, nodes: [10, 11, 12], revision: 1 }],
          [EAST_SHARD_ID, { block: EAST_BLOCK, nodes: [200], revision: 1 }],
        ]),
      ),
    );
    const changes = tracker.update(
      snapshotOf(2, new Map([[WEST_SHARD_ID, { block: WEST_BLOCK, nodes: [10, 12, 13], revision: 2 }]])),
    );
    expect(changes).toEqual({ added: [13], removed: [11, 200] });
  });
});
