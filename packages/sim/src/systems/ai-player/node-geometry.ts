import { Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';

/** The half-cell node under an entity's Position, or null for an unpositioned entity. */
export function anchorNodeOf(world: World, e: Entity): HalfCellNode | null {
  const pos = world.tryGet(e, Position);
  return pos === undefined ? null : nodeOfPosition(pos.x, pos.y);
}

/** The integer-mean node of the entities' anchors (the settlement centroid when fed the seat's
 *  buildings), or null when none has a Position. Commutative sums - no canonical order needed. */
export function anchorCentroid(world: World, entities: readonly Entity[]): HalfCellNode | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const e of entities) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    sx += node.hx;
    sy += node.hy;
    n++;
  }
  return n === 0 ? null : { hx: Math.floor(sx / n), hy: Math.floor(sy / n) };
}

/**
 * `from` pushed `push` nodes further away from `origin` along the straight `origin → from` ray.
 * Integer-trunc ray projection (the `searchCentre` idiom): plain `/` on integer operands is
 * IEEE-exact-rounded, hence byte-identical across engines. Coincident points have no direction -
 * `from` is returned as-is.
 */
export function outwardNode(origin: HalfCellNode, from: HalfCellNode, push: number): HalfCellNode {
  const dx = from.hx - origin.hx;
  const dy = from.hy - origin.hy;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist === 0) return from;
  return {
    hx: from.hx + Math.trunc((dx * push) / dist),
    hy: from.hy + Math.trunc((dy * push) / dist),
  };
}

/**
 * The node `push` nodes from `from` along the straight ray to `target`, `target` itself once that is nearer.
 * Integer-trunc ray projection as in {@link outwardNode}, byte-identical across engines.
 */
export function towardNode(from: HalfCellNode, target: HalfCellNode, push: number): HalfCellNode {
  const dx = target.hx - from.hx;
  const dy = target.hy - from.hy;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist <= push) return target;
  return {
    hx: from.hx + Math.trunc((dx * push) / dist),
    hy: from.hy + Math.trunc((dy * push) / dist),
  };
}

/**
 * The first node accepted while walking expanding Manhattan rings around `(cx, cy)` - the modules'
 * "closest legal spot" pick. Deterministic: ascending radius, then ascending dx, north (y−) before
 * south (y+), so the winner never depends on iteration state. `accept` must reject out-of-bounds
 * nodes itself. Cost is O(maxRadius²) accepts at worst - bounded, never a whole-map scan.
 */
export function firstRingNode(
  cx: number,
  cy: number,
  maxRadius: number,
  accept: (x: number, y: number) => boolean,
): HalfCellNode | null {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      if (accept(cx + dx, cy - dy)) return { hx: cx + dx, hy: cy - dy };
      if (dy !== 0 && accept(cx + dx, cy + dy)) return { hx: cx + dx, hy: cy + dy };
    }
  }
  return null;
}

/**
 * The accepted node of least `ring radius + penalty(x, y)` over the {@link firstRingNode} walk, the first
 * walked on ties, or null. `penalty` must be a non-negative integer: a node's cost is then never below
 * its ring, so the walk stops at the first ring no longer under the best cost, and `accept` runs only on
 * a node that would beat it.
 */
export function bestRingNode(
  cx: number,
  cy: number,
  maxRadius: number,
  penalty: (x: number, y: number) => number,
  accept: (x: number, y: number) => boolean,
): HalfCellNode | null {
  let best: HalfCellNode | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= maxRadius && r < bestCost; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      // North (y−) first, then south; the equator node once.
      for (let side = dy === 0 ? 1 : 0; side < 2; side++) {
        const y = side === 0 ? cy - dy : cy + dy;
        const cost = r + penalty(cx + dx, y);
        if (cost >= bestCost || !accept(cx + dx, y)) continue;
        best = { hx: cx + dx, hy: y };
        bestCost = cost;
      }
    }
  }
  return best;
}

/**
 * The accepted node nearest `origin` (Manhattan) on the innermost ring of `minRadius..maxRadius` around
 * `(cx, cy)` holding one, the first walked on ties, or null: the {@link firstRingNode} walk with each
 * ring settled toward `origin`, so a spot beside a resource lands on the side its walkers come from.
 */
export function nearestRingNode(
  cx: number,
  cy: number,
  minRadius: number,
  maxRadius: number,
  origin: HalfCellNode,
  accept: (x: number, y: number) => boolean,
): HalfCellNode | null {
  for (let r = minRadius; r <= maxRadius; r++) {
    let best: HalfCellNode | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dx = -r; dx <= r; dx++) {
      const dy = r - Math.abs(dx);
      for (let side = dy === 0 ? 1 : 0; side < 2; side++) {
        const x = cx + dx;
        const y = side === 0 ? cy - dy : cy + dy;
        const distance = Math.abs(x - origin.hx) + Math.abs(y - origin.hy);
        if (distance >= bestDistance || !accept(x, y)) continue;
        best = { hx: x, hy: y };
        bestDistance = distance;
      }
    }
    if (best !== null) return best;
  }
  return null;
}
