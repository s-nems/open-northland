import type { Fixed } from '../../core/fixed.js';
import type { NodeId } from './types.js';

/** One emitted lattice edge: the destination node and the fixed-point cost of stepping onto it. */
export interface Step {
  node: NodeId;
  cost: Fixed;
}

/**
 * A reusable sink for {@link TerrainGraph.stepsInto}. The A* inner loop and the build-time component
 * flood fill re-fill one buffer per settled node instead of minting an array plus a record per edge;
 * slots are created on first use (at most 8 — the lattice's edge count) and overwritten thereafter,
 * with `length` marking how many are live. Contents are valid only until the next fill.
 */
export class StepBuffer {
  private readonly slots: Step[] = [];
  /** Number of live slots — everything at or past this index is stale from an earlier fill. */
  length = 0;

  /** Drop the live slots, keeping their storage for the next fill. */
  reset(): void {
    this.length = 0;
  }

  /** Append an emitted edge, reusing an existing slot when this buffer has already held one. */
  push(node: NodeId, cost: Fixed): void {
    const slot = this.slots[this.length];
    if (slot === undefined) this.slots.push({ node, cost });
    else {
      slot.node = node;
      slot.cost = cost;
    }
    this.length += 1;
  }

  /** The live edge at `index`. Throws past {@link length} — reading a stale slot is a programmer
   *  error, not a recoverable boundary. */
  at(index: number): Readonly<Step> {
    const slot = index < this.length ? this.slots[index] : undefined;
    if (slot === undefined) throw new Error(`step index ${index} out of range (0..${this.length - 1})`);
    return slot;
  }
}
