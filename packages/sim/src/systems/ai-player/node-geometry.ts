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
