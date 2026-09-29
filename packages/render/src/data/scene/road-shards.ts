import { entitiesWith, type WorldSnapshot } from '@open-northland/sim';
import { type RoadShardView, roadRevisionOf, roadShardOf } from './snapshot-index.js';

/** The road nodes (half-cell row-major ids) laid and lifted since the previous read. */
export interface RoadChanges {
  readonly added: readonly number[];
  readonly removed: readonly number[];
}

/**
 * The road network's changes between the snapshots it is given: one revision compare per snapshot, and
 * per change a diff of only the shards whose value moved, so the cost follows the changed blocks
 * rather than the network.
 */
export class RoadShardTracker {
  private revision = 0;
  /** The last shard value seen per carrier entity id. */
  private readonly held = new Map<number, RoadShardView>();

  /** The changes since the previous call, or null when the network did not move. */
  update(snapshot: WorldSnapshot): RoadChanges | null {
    const revision = roadRevisionOf(snapshot);
    if (revision === this.revision) return null;
    this.revision = revision;
    const added: number[] = [];
    const removed: number[] = [];
    const seen = new Set<number>();
    for (const entity of entitiesWith(snapshot, 'RoadShard')) {
      const shard = roadShardOf(entity);
      if (shard === null) continue;
      seen.add(entity.id);
      const before = this.held.get(entity.id);
      if (before === shard || before?.revision === shard.revision) continue;
      this.held.set(entity.id, shard);
      diffNodes(before?.nodes ?? [], shard.nodes, added, removed);
    }
    for (const [id, before] of this.held) {
      if (seen.has(id)) continue;
      this.held.delete(id);
      removed.push(...before.nodes);
    }
    return { added, removed };
  }
}

/** Append to `added` and `removed` what turns `before` into `after`; a shard that only grew, the usual
 *  lay, costs one compare per node it held. */
function diffNodes(
  before: readonly number[],
  after: readonly number[],
  added: number[],
  removed: number[],
): void {
  let prefix = 0;
  while (prefix < before.length && before[prefix] === after[prefix]) prefix++;
  if (prefix === before.length) {
    for (const id of after.slice(prefix)) added.push(id);
    return;
  }
  const next = new Set(after);
  const previous = new Set(before);
  for (const id of before) if (!next.has(id)) removed.push(id);
  for (const id of after) if (!previous.has(id)) added.push(id);
}
