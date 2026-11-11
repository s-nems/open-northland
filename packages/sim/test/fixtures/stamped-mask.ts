import { type BlockLanes, NodeMask } from '../../src/nav/block-overlay.js';
import { NodeChangeStamps } from '../../src/nav/change-stamps.js';
import type { NodeArea } from '../../src/nav/halfcell.js';
import type { FlipStampedBlocks } from '../../src/nav/pathfinding/cluster-regions.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';

/** A walk-block mask that stamps its flips as the world's structure mask does, flipped by hand. */
export class StampedMask implements FlipStampedBlocks {
  private readonly mask: NodeMask;
  private readonly stamps: NodeChangeStamps;
  version = 0;

  constructor(private readonly terrain: TerrainGraph) {
    this.mask = new NodeMask(terrain.nodeCount);
    this.stamps = new NodeChangeStamps(terrain.width, terrain.height);
  }

  has(node: NodeId): boolean {
    return this.mask.has(node);
  }

  get size(): number {
    return this.mask.size;
  }

  blockLanes(): BlockLanes {
    return this.mask.blockLanes();
  }

  flippedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean {
    return this.stamps.anyChangedSince(area, since, test);
  }

  /** Flip `node`; `stamped: false` is the defect a cache verifier must catch. */
  flip(node: NodeId, stamped = true): void {
    this.mask.set(node, !this.mask.has(node));
    if (!stamped) return;
    this.version += 1;
    this.stamps.stamp(this.terrain.xOf(node), this.terrain.yOf(node), this.version);
  }
}
