import { type Fixed, fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeMarksOf } from '../../nav/pathfinding/index.js';
import { latticeDistanceTo, type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW } from '../../nav/world-metric.js';

interface LaneStep {
  readonly node: NodeId;
  readonly x: number;
  readonly y: number;
  /** The edge's world length. */
  readonly cost: Fixed;
  readonly weight: Fixed;
}

/** Cheap, fully checked alternatives to funnelling every walker onto the same corridor nodes.
 * Approximation: player groups prefer separate lanes over equal-cost shared routes. */
export class GroupLanes {
  private readonly steps = new StepBuffer();
  private readonly edges = new Map<BlockOverlay, Map<NodeId, readonly LaneStep[]>>();
  private shifted = new WeakMap<readonly NodeId[], Map<BlockOverlay, Map<string, NodeId[] | null>>>();

  constructor(private readonly terrain: TerrainGraph) {}

  /** Routing calls this when the live footprint mask changes within the request drain. Body overlays
   * are held for that drain; neither these edge checks nor shifted corridors survive into another tick. */
  reset(): void {
    this.edges.clear();
    this.shifted = new WeakMap();
  }

  private edgesAt(blocked: BlockOverlay, node: NodeId): readonly LaneStep[] {
    let nodes = this.edges.get(blocked);
    if (nodes === undefined) {
      nodes = new Map();
      this.edges.set(blocked, nodes);
    }
    const held = nodes.get(node);
    if (held !== undefined) return held;
    this.terrain.stepsInto(node, blocked, this.steps);
    const edges = Array.from({ length: this.steps.length }, (_, index) => {
      const next = this.steps.nodeAt(index);
      return {
        node: next,
        x: this.terrain.xOf(next),
        y: this.terrain.yOf(next),
        cost: this.steps.costAt(index),
        weight: this.terrain.routeWeightAt(next, 'land'),
      };
    });
    nodes.set(node, edges);
    return edges;
  }

  /** Whether one of the pathfinder's steps leads from `from` to `to` under `blocked`. */
  private joinsByStep(blocked: BlockOverlay, from: NodeId, to: NodeId): boolean {
    return this.edgesAt(blocked, from).some((step) => step.node === to);
  }

  /** A shortest geometric lane, or null as soon as an obstacle requires a detour. Keeping each step
   * at or below the reference route's mean resistance preserves useful roads and avoids rough ground. */
  direct(blocked: BlockOverlay, start: NodeId, goal: NodeId, maxWeight: Fixed): NodeId[] | null {
    const { terrain } = this;
    if (!terrain.isWalkable(start) || !terrain.isWalkable(goal) || blocked.has(goal)) return null;
    const sx = terrain.xOf(start),
      sy = terrain.yOf(start);
    const gx = terrain.xOf(goal),
      gy = terrain.yOf(goal);
    const dx = gx - sx,
      dy = gy - sy;
    const path = [start];
    let at = start;
    while (at !== goal) {
      // A step stays on a shortest open-lattice walk exactly when its length and the open distance left
      // from its landing add up to the distance left from here.
      const remaining = latticeDistanceTo(terrain, gx, gy, at);
      let chosen: NodeId | undefined;
      let deviation = Number.POSITIVE_INFINITY;
      const steps = this.edgesAt(blocked, at);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i] as LaneStep;
        if (step.weight > maxWeight) continue;
        if (fx.add(step.cost, latticeDistanceTo(terrain, gx, gy, step.node)) !== remaining) continue;
        const side = Math.abs((step.x - sx) * dy - (step.y - sy) * dx);
        if (side < deviation || (side === deviation && (chosen === undefined || step.node < chosen))) {
          chosen = step.node;
          deviation = side;
        }
      }
      if (chosen === undefined) return null;
      path.push(chosen);
      at = chosen;
    }
    return path;
  }

  /** Translate a neighbour's detour into this unit's lane. Every edge is revalidated, and a slanted edge
   * the shifted row leans away from is walked as two straight edges; a wall, bank or map boundary falls back to the shared corridor. */
  translated(
    blocked: BlockOverlay,
    route: readonly NodeId[],
    start: NodeId,
    goal: NodeId,
    maxWeight: Fixed,
    maxOffset: number,
  ): NodeId[] | null {
    const first = route[0],
      last = route.at(-1);
    if (first === undefined || last === undefined) return null;
    const { terrain } = this;
    // Only shift across the march. Shifting its forward coordinate also shifts the obstacle's corner,
    // invalidating a perfectly useful parallel lane for every neighbouring column of the army.
    const horizontal =
      Math.abs(terrain.xOf(last) - terrain.xOf(first)) * HALF_COLUMN >=
      Math.abs(terrain.yOf(last) - terrain.yOf(first)) * HALF_ROW;
    const dx = horizontal ? 0 : terrain.xOf(start) - terrain.xOf(first);
    const dy = horizontal ? terrain.yOf(start) - terrain.yOf(first) : 0;
    if (Math.abs(dx) + Math.abs(dy) > maxOffset) return null;
    let byOverlay = this.shifted.get(route);
    if (byOverlay === undefined) {
      byOverlay = new Map();
      this.shifted.set(route, byOverlay);
    }
    let candidates = byOverlay.get(blocked);
    if (candidates === undefined) {
      candidates = new Map();
      byOverlay.set(blocked, candidates);
    }
    const key = `${dx},${dy},${maxWeight}`;
    let shifted = candidates.get(key);
    if (shifted === undefined) {
      shifted = this.shiftRoute(blocked, route, dx, dy, maxWeight);
      candidates.set(key, shifted);
    }
    if (shifted === null) return null;
    let entry = 0,
      distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < shifted.length; i++) {
      const node = shifted[i];
      if (node === undefined || blocked.has(node)) continue;
      const next = latticeDistanceTo(terrain, terrain.xOf(start), terrain.yOf(start), node);
      if (next < distance) {
        entry = i;
        distance = next;
      }
    }
    const join = shifted[entry];
    if (
      join === undefined ||
      Math.abs(terrain.xOf(join) - terrain.xOf(start)) + Math.abs(terrain.yOf(join) - terrain.yOf(start)) >
        maxOffset
    )
      return null;
    const onto = this.direct(blocked, start, join, maxWeight);
    if (onto === null) return null;
    const goalIndex = shifted.indexOf(goal, entry);
    if (goalIndex >= 0) return this.stitch(onto, shifted.slice(entry, goalIndex + 1));
    const end = shifted.at(-1);
    if (end === undefined) return null;
    if (
      Math.abs(terrain.xOf(end) - terrain.xOf(goal)) + Math.abs(terrain.yOf(end) - terrain.yOf(goal)) >
      maxOffset
    )
      return null;
    const tail = this.direct(blocked, end, goal, maxWeight);
    return tail === null ? null : this.stitch(this.stitch(onto, shifted.slice(entry)), tail);
  }

  private shiftRoute(
    blocked: BlockOverlay,
    route: readonly NodeId[],
    dx: number,
    dy: number,
    maxWeight: Fixed,
  ): NodeId[] | null {
    const { terrain } = this;
    const first = route[0];
    if (first === undefined) return null;
    const startX = terrain.xOf(first) + dx,
      startY = terrain.yOf(first) + dy;
    if (!terrain.inBounds(startX, startY)) return null;
    const shifted: NodeId[] = [terrain.nodeAt(startX, startY)];
    for (let i = 1; i < route.length; i++) {
      const original = route[i],
        previous = shifted.at(-1);
      if (original === undefined || previous === undefined) return null;
      const x = terrain.xOf(original) + dx,
        y = terrain.yOf(original) + dy;
      if (!terrain.inBounds(x, y)) return null;
      const next = terrain.nodeAt(x, y);
      if (terrain.routeWeightAt(next, 'land') > maxWeight) return null;
      if (!this.joinsByStep(blocked, previous, next)) {
        // An odd row shift flips every node's row parity, where a slant edge leans the other way: walk it
        // as the straight row edge and the half-column step, through whichever middle is open.
        const slanted =
          Math.abs(x - terrain.xOf(previous)) === 1 && Math.abs(y - terrain.yOf(previous)) === 1;
        const middle = slanted ? this.bridge(blocked, previous, next, dy, maxWeight) : null;
        if (middle === null) return null;
        shifted.push(middle);
      }
      shifted.push(next);
    }
    return shifted;
  }

  /** The open node joining `from` to `to`, one column and one row apart, by two edges, a straight row
   *  edge and a half-column step: first through the middle on the row farther along the shift `dy`, which
   *  keeps a lane one row off the leader off the leader's own nodes, then the other; null when neither
   *  middle is open. */
  private bridge(
    blocked: BlockOverlay,
    from: NodeId,
    to: NodeId,
    dy: number,
    maxWeight: Fixed,
  ): NodeId | null {
    const { terrain } = this;
    const fromX = terrain.xOf(from);
    const fromY = terrain.yOf(from);
    const toX = terrain.xOf(to);
    const toY = terrain.yOf(to);
    const onFromRow = terrain.nodeAt(toX, fromY);
    const onToRow = terrain.nodeAt(fromX, toY);
    const fromRowFarther = dy > 0 ? fromY > toY : fromY < toY;
    for (const middle of fromRowFarther ? [onFromRow, onToRow] : [onToRow, onFromRow]) {
      if (terrain.routeWeightAt(middle, 'land') > maxWeight) continue;
      if (this.joinsByStep(blocked, from, middle) && this.joinsByStep(blocked, middle, to)) return middle;
    }
    return null;
  }

  /** Once past the obstacle, leave the shared lane towards the unit's own slot. Probing logarithmically
   * bounds the work; visibility need not be monotone because only a successfully checked lane is used. */
  departEarly(blocked: BlockOverlay, route: NodeId[], goal: NodeId, maxWeight: Fixed): NodeId[] {
    let low = 0,
      high = route.length - 1;
    let tail: NodeId[] | null = null;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      const node = route[middle];
      if (node === undefined) break;
      const candidate = this.direct(blocked, node, goal, maxWeight);
      if (candidate === null) low = middle;
      else {
        high = middle;
        tail = candidate;
      }
    }
    return tail === null ? route : this.stitch(route, tail, high + 1);
  }

  /** `prefix[0..end)` then `tail`. A connector may meet the corridor before its endpoint. Drop that loop
   * while preserving every legal edge; the cached corridor itself is never mutated. */
  private stitch(prefix: readonly NodeId[], tail: readonly NodeId[], end = prefix.length): NodeId[] {
    const marks = nodeMarksOf(this.terrain);
    const mark = marks.next();
    // The last index of each prefix node, as a node may repeat.
    for (let i = 0; i < end; i++) {
      const node = prefix[i];
      if (node === undefined) continue;
      marks.stamps[node] = mark;
      marks.values[node] = i;
    }
    let prefixEnd = end,
      tailStart = 0;
    for (let i = 0; i < tail.length; i++) {
      const node = tail[i];
      if (node === undefined || marks.stamps[node] !== mark) continue;
      prefixEnd = (marks.values[node] ?? 0) + 1;
      tailStart = i + 1;
    }
    const joined = prefix.slice(0, prefixEnd);
    for (let i = tailStart; i < tail.length; i++) {
      const node = tail[i];
      if (node !== undefined) joined.push(node);
    }
    return joined;
  }
}
