import type { NodeId } from './terrain/index.js';

// Thrown from outside `at`, which a message built in line would make too large to inline.
function throwPastLength(i: number, length: number): never {
  throw new RangeError(`NodeList.at(${i}) past length ${length}`);
}

/** Scratch node ids filled by count and never truncated, so a reused list keeps its capacity: setting a
 *  plain array's length to zero drops its backing store, and every refill then grows it again. */
export class NodeList {
  readonly nodes: NodeId[] = [];
  length = 0;

  push(node: NodeId): void {
    this.nodes[this.length++] = node;
  }

  /** The node at `i`; a slot at or past {@link length} holds a stale node and is refused. */
  at(i: number): NodeId {
    if (i >= this.length) throwPastLength(i, this.length);
    return this.nodes[i] as NodeId;
  }

  clear(): void {
    this.length = 0;
  }
}
