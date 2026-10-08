import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { WalkBlockMask } from '../footprint/walk-block-mask.js';

/** Exact regions, paid for only after a player route fails. Routing holds its standing-body index for
 * the whole pass; each owner's overlay needs separate labels because a post blocks only its enemies. */
export class GroupReachability {
  private readonly regions = new Map<BlockOverlay, Int32Array>();
  private version = -1;
  private nextLabel = 1;
  private readonly fromStart: NodeId[] = [];
  private readonly fromGoal: NodeId[] = [];
  private readonly steps = new StepBuffer();

  constructor(private readonly terrain: TerrainGraph) {}

  unreachable(mask: WalkBlockMask, blocked: BlockOverlay, start: NodeId, goal: NodeId): boolean {
    this.refresh(mask);
    if (this.terrain.componentOf(start) !== this.terrain.componentOf(goal)) return true;
    // A blocked start may escape into several regions; leave that special case to the pathfinder.
    if (blocked.has(start) || blocked.has(goal)) return false;
    const labels = this.regions.get(blocked);
    const from = labels?.[start] ?? 0;
    const to = labels?.[goal] ?? 0;
    // Every labeled component was exhausted, so an unlabeled endpoint cannot belong to it.
    return from !== to;
  }

  /** Exhaust the smaller endpoint region, so a tiny sealed goal never floods its open surroundings.
   *  Both searches take one step per round. A connected pair learns nothing; only complete regions
   *  survive, and unfinished labels are private to this synchronous call. */
  rememberFailure(mask: WalkBlockMask, blocked: BlockOverlay, start: NodeId, goal: NodeId): void {
    this.refresh(mask);
    if (
      !this.terrain.isWalkable(start) ||
      !this.terrain.isWalkable(goal) ||
      blocked.has(start) ||
      blocked.has(goal) ||
      start === goal ||
      this.terrain.componentOf(start) !== this.terrain.componentOf(goal)
    )
      return;
    let labels = this.regions.get(blocked);
    if (labels === undefined) {
      labels = new Int32Array(this.terrain.nodeCount);
      this.regions.set(blocked, labels);
    }
    if (labels[start] !== 0 || labels[goal] !== 0) return;
    const { fromStart, fromGoal } = this;
    fromStart.length = 0;
    fromGoal.length = 0;
    fromStart.push(start);
    fromGoal.push(goal);
    labels[start] = -1;
    labels[goal] = -2;
    let complete: readonly NodeId[] | undefined;
    for (let cursor = 0; ; cursor++) {
      if (
        !this.expand(fromStart, cursor, -1, labels, blocked) ||
        !this.expand(fromGoal, cursor, -2, labels, blocked)
      )
        break;
      if (cursor + 1 === fromStart.length) {
        complete = fromStart;
        break;
      }
      if (cursor + 1 === fromGoal.length) {
        complete = fromGoal;
        break;
      }
    }
    for (const node of fromStart) labels[node] = 0;
    for (const node of fromGoal) labels[node] = 0;
    if (complete !== undefined) {
      const label = this.nextLabel++;
      for (const node of complete) labels[node] = label;
    }
  }

  private expand(
    queue: NodeId[],
    cursor: number,
    marker: number,
    labels: Int32Array,
    blocked: BlockOverlay,
  ): boolean {
    const node = queue[cursor];
    if (node === undefined) throw new Error('group region queue missing a node');
    this.terrain.stepsInto(node, blocked, this.steps);
    for (let i = 0; i < this.steps.length; i++) {
      const next = this.steps.nodeAt(i);
      const seen = labels[next];
      if (seen === marker) continue;
      // Meeting the other search proves reachability; never publish either partial region.
      if (seen !== 0) return false;
      labels[next] = marker;
      queue.push(next);
    }
    return true;
  }

  private refresh(mask: WalkBlockMask): void {
    const version = mask.version;
    if (this.version === version) return;
    this.version = version;
    this.regions.clear();
    this.nextLabel = 1;
  }
}
