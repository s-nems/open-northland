import type { Fixed } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { latticeDistanceTo, type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import { HALF_COLUMN, HALF_ROW } from '../../nav/world-metric.js';

interface LaneStep {
  readonly node: NodeId;
  readonly x: number;
  readonly y: number;
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
        weight: this.terrain.routeWeightAt(next, 'land'),
      };
    });
    nodes.set(node, edges);
    return edges;
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
      const x = terrain.xOf(at),
        y = terrain.yOf(at);
      const remainingX = Math.abs(gx - x),
        remainingY = Math.abs(gy - y);
      const directionX = Math.sign(gx - x),
        directionY = Math.sign(gy - y);
      let chosen: NodeId | undefined;
      let deviation = Number.POSITIVE_INFINITY;
      for (const step of this.edgesAt(blocked, at)) {
        const next = step.node;
        if (step.weight > maxWeight) continue;
        const advanceX = step.x - x,
          advanceY = step.y - y;
        if (
          (advanceX !== 0 && advanceX !== directionX) ||
          (advanceY !== 0 && Math.sign(advanceY) !== directionY)
        )
          continue;
        // A shortest lattice route uses min(dx,floor(dy/2)) diagonal (1,2) edges, then its remaining
        // horizontal/vertical edges in any order. These integer conditions are exactly the old
        // edgeCost + distance(next,goal) === distance(at,goal) test, without eight heuristics per step.
        if (advanceX !== 0 && advanceY !== 0) {
          if (remainingY < 2) continue;
        } else if (advanceX !== 0) {
          if (remainingX <= Math.floor(remainingY / 2)) continue;
        } else if (remainingY <= 2 * remainingX && (remainingY & 1) === 0) continue;
        const side = Math.abs((step.x - sx) * dy - (step.y - sy) * dx);
        if (side < deviation || (side === deviation && (chosen === undefined || next < chosen))) {
          chosen = next;
          deviation = side;
        }
      }
      if (chosen === undefined) return null;
      path.push(chosen);
      at = chosen;
    }
    return path;
  }

  /** Translate a neighbour's detour into this unit's lane. Every edge is revalidated, including the
   * diagonal flank rule; a wall, bank or map boundary falls back to the shared corridor. */
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
      if (!this.edgesAt(blocked, previous).some((step) => step.node === next)) return null;
      shifted.push(next);
    }
    return shifted;
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
    return tail === null ? route : this.stitch(route.slice(0, high + 1), tail);
  }

  /** A connector may meet the corridor before its endpoint. Drop that loop while preserving every
   * legal edge; the cached corridor itself is never mutated. */
  private stitch(prefix: readonly NodeId[], tail: readonly NodeId[]): NodeId[] {
    const index = new Map(prefix.map((node, i) => [node, i]));
    let prefixEnd = prefix.length,
      tailStart = 0;
    for (let i = 0; i < tail.length; i++) {
      const node = tail[i];
      const seen = node === undefined ? undefined : index.get(node);
      if (seen !== undefined) {
        prefixEnd = seen + 1;
        tailStart = i + 1;
      }
    }
    return [...prefix.slice(0, prefixEnd), ...tail.slice(tailStart)];
  }
}
