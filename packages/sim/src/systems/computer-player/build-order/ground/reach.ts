import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from '../order/limits.js';

/** The ground a placement may take: within a radius (Manhattan) of one of the seat's buildings, sites
 *  included, so the settlement keeps growing from wherever it stands. */
export interface BuildReach {
  contains(x: number, y: number): boolean;
  /** Whether some building's disc meets the Manhattan disc of `span` around `centre`: what a search
   *  fanning that far from its centre can reach at all. */
  meets(centre: HalfCellNode, span: number): boolean;
  /** `node` itself when inside, else pulled onto the disc edge of the building nearest it. */
  clamp(node: HalfCellNode): HalfCellNode;
  /** The same reach cut to the buildings whose discs meet the Manhattan disc of `span` around `centre`,
   *  for a search that never leaves that disc. */
  around(centre: HalfCellNode, span: number): BuildReach;
  /** {@link contains} for a search that tests most of the box of `span` around `centre`: the reach over
   *  that box is laid out once, so each test there is one read. */
  boxTest(centre: HalfCellNode, span: number): (x: number, y: number) => boolean;
}

/** The {@link BuildReach} of the seat's `owned` buildings, or of `fallback` alone while none has a node. */
export function buildReach(
  world: World,
  owned: readonly Entity[],
  fallback: HalfCellNode,
  radius = BUILD_SEARCH_MAX_RADIUS_NODES,
): BuildReach {
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node !== null) centres.push(node);
  }
  if (centres.length === 0) centres.push(fallback);
  return reachOver(centres, fallback, radius);
}

function reachOver(centres: readonly HalfCellNode[], fallback: HalfCellNode, radius: number): BuildReach {
  // Ring walks test runs of nearby nodes, so the centre that took the last one goes first.
  let last = 0;
  const within = (c: HalfCellNode | undefined, x: number, y: number): boolean =>
    c !== undefined && Math.abs(x - c.hx) + Math.abs(y - c.hy) <= radius;
  const contains = (x: number, y: number): boolean => {
    if (within(centres[last], x, y)) return true;
    for (let i = 0; i < centres.length; i++) {
      if (!within(centres[i], x, y)) continue;
      last = i;
      return true;
    }
    return false;
  };
  return {
    contains,
    boxTest(centre, span) {
      const x0 = centre.hx - span;
      const y0 = centre.hy - span;
      const side = 2 * span + 1;
      // Each centre's disc adds one interval per row: +1 at its west end, -1 past its east end.
      const ends = new Int32Array(side * (side + 1));
      for (const c of centres) {
        const top = Math.max(y0, c.hy - radius);
        const bottom = Math.min(y0 + side - 1, c.hy + radius);
        for (let y = top; y <= bottom; y++) {
          const half = radius - Math.abs(y - c.hy);
          const lo = Math.max(x0, c.hx - half) - x0;
          const hi = Math.min(x0 + side - 1, c.hx + half) - x0;
          if (lo > hi) continue;
          const row = (y - y0) * (side + 1);
          ends[row + lo] = (ends[row + lo] ?? 0) + 1;
          ends[row + hi + 1] = (ends[row + hi + 1] ?? 0) - 1;
        }
      }
      const inside = new Uint8Array(side * side);
      for (let row = 0; row < side; row++) {
        let open = 0;
        for (let i = 0; i < side; i++) {
          open += ends[row * (side + 1) + i] ?? 0;
          if (open > 0) inside[row * side + i] = 1;
        }
      }
      return (x, y) => {
        const i = x - x0;
        const j = y - y0;
        if (i < 0 || j < 0 || i >= side || j >= side) return contains(x, y);
        return inside[j * side + i] === 1;
      };
    },
    meets(centre, span) {
      return centres.some((c) => nodeManhattan(c, centre) <= span + radius);
    },
    around(centre, span) {
      return reachOver(
        centres.filter((c) => nodeManhattan(c, centre) <= span + radius),
        fallback,
        radius,
      );
    },
    clamp(node) {
      let nearest = centres[0] ?? fallback;
      for (const c of centres) if (nodeManhattan(node, c) < nodeManhattan(node, nearest)) nearest = c;
      const dx = node.hx - nearest.hx;
      const dy = node.hy - nearest.hy;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= radius) return node;
      // Integer projection toward the building; trunc keeps |dx'|+|dy'| ≤ the radius. Plain `/` on integer
      // operands is exactly rounded, so the result is byte-identical across engines.
      return {
        hx: nearest.hx + Math.trunc((dx * radius) / dist),
        hy: nearest.hy + Math.trunc((dy * radius) / dist),
      };
    },
  };
}
