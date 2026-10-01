import type { Fixed } from '../../core/fixed.js';
import type { NodeId } from './node-id.js';

/** One emitted lattice edge: the destination node and the edge's fixed-point world length. */
export interface Step {
  node: NodeId;
  cost: Fixed;
}

/** The most edges one node emits: the lattice's eight directions. */
const MAX_STEPS = 8;

/**
 * A reusable sink for {@link TerrainGraph.stepsInto}, held in typed slots so a fill writes no object.
 * Contents are valid only until the next fill.
 */
export class StepBuffer {
  private readonly nodes = new Int32Array(MAX_STEPS);
  private readonly costs = new Float64Array(MAX_STEPS);
  /** One {@link at} view per slot, minted on first read and refreshed on each later one. */
  private readonly views: Step[] = [];
  /** Number of live slots; everything at or past this index is stale from an earlier fill. */
  length = 0;

  /** Drop the live slots, keeping their storage for the next fill. */
  reset(): void {
    this.length = 0;
  }

  /** Append an emitted edge. */
  push(node: NodeId, cost: Fixed): void {
    if (this.length >= MAX_STEPS) throw new Error(`a node emits at most ${MAX_STEPS} steps`);
    this.nodes[this.length] = node;
    this.costs[this.length] = cost;
    this.length += 1;
  }

  /** The live edge's destination at `index`. Throws past {@link length}, since a stale slot is never a
   *  valid read. */
  nodeAt(index: number): NodeId {
    this.checkLive(index);
    // The slots hold the pushed brands; a typed array only drops them.
    return (this.nodes[index] ?? 0) as NodeId;
  }

  /** The live edge's world length at `index`. */
  costAt(index: number): Fixed {
    this.checkLive(index);
    return (this.costs[index] ?? 0) as Fixed;
  }

  /** The live edge at `index` as an object, valid until the next fill. Hot loops read {@link nodeAt}. */
  at(index: number): Readonly<Step> {
    const node = this.nodeAt(index);
    const cost = this.costAt(index);
    const view = this.views[index];
    if (view === undefined) {
      const minted = { node, cost };
      this.views[index] = minted;
      return minted;
    }
    view.node = node;
    view.cost = cost;
    return view;
  }

  private checkLive(index: number): void {
    if (index >= this.length || index < 0) {
      throw new Error(`step index ${index} out of range (0..${this.length - 1})`);
    }
  }
}
