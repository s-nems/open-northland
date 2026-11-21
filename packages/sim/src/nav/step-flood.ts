import type { BlockOverlay } from './block-overlay.js';
import { NodeList } from './node-list.js';
import { type NodeId, StepBuffer, type TerrainGraph } from './terrain/index.js';

/** The largest visit stamp before the stamps wrap and are cleared. */
const MAX_STAMP = 0x7fffffff;

/**
 * A breadth-first walk from one node over the steps a land walker takes under an overlay, expanded one
 * level of walking steps at a time, so a caller stops at the first level that answers it. Its scratch is
 * reused across floods; a flood's answers hold until the next {@link begin}.
 */
export class StepFlood {
  /** Every node reached so far, level by level, each level in the canonical step order of the nodes
   *  before it. */
  readonly order = new NodeList();
  private start = 0;
  private end = 0;
  private readonly seen: Int32Array;
  /** Each reached node's predecessor on the walk from the start, the start's its own. */
  private readonly cameFrom: Int32Array;
  /** Each reached node's walking steps from the start, valid where {@link seen} holds the stamp. */
  private readonly stepsOf: Int32Array;
  private level = 0;
  private stamp = 0;
  private overlay: BlockOverlay | undefined;
  private readonly steps = new StepBuffer();

  constructor(private readonly terrain: TerrainGraph) {
    this.seen = new Int32Array(terrain.nodeCount);
    this.cameFrom = new Int32Array(terrain.nodeCount);
    this.stepsOf = new Int32Array(terrain.nodeCount);
  }

  /** The current level's slice of {@link order}. */
  get levelStart(): number {
    return this.start;
  }
  get levelEnd(): number {
    return this.end;
  }
  /** How many levels the flood has expanded: the walking steps of the current level's nodes. */
  get depth(): number {
    return this.level;
  }

  /** Start a flood at `from` (level 0), stepping onto the nodes `overlay` leaves open. */
  begin(from: NodeId, overlay: BlockOverlay): void {
    if (this.stamp === MAX_STAMP) {
      this.seen.fill(0);
      this.stamp = 0;
    }
    this.stamp += 1;
    this.overlay = overlay;
    this.order.clear();
    this.order.push(from);
    this.seen[from] = this.stamp;
    this.cameFrom[from] = from;
    this.stepsOf[from] = 0;
    this.level = 0;
    this.start = 0;
    this.end = 1;
  }

  /** Expand the current level by one step; false once no node is left to reach. */
  nextLevel(): boolean {
    const { order, seen, cameFrom, stepsOf, stamp, steps, terrain } = this;
    const level = this.level + 1;
    for (let i = this.start; i < this.end; i++) {
      const node = order.at(i);
      terrain.stepsInto(node, this.overlay, steps);
      for (let k = 0; k < steps.length; k++) {
        const next = steps.nodeAt(k);
        if (seen[next] === stamp) continue;
        seen[next] = stamp;
        cameFrom[next] = node;
        stepsOf[next] = level;
        order.push(next);
      }
    }
    this.start = this.end;
    this.end = order.length;
    if (this.end === this.start) return false;
    this.level = level;
    return true;
  }

  /** Whether the flood has reached `node`. */
  reached(node: NodeId): boolean {
    return this.seen[node] === this.stamp;
  }

  /** The walking steps from the flood's start to the reached `node`. */
  stepsTo(node: NodeId): number {
    return this.stepsOf[node] ?? 0;
  }

  /** The walk from the flood's start to the reached `node`, both included, one step per node. */
  walkTo(node: NodeId): NodeId[] {
    const walk: NodeId[] = [node];
    for (let at = node; this.cameFrom[at] !== at; ) {
      at = this.cameFrom[at] as NodeId;
      walk.push(at);
    }
    return walk.reverse();
  }
}
