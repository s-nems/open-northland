import type { World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { interactionNode, routeRegions } from '../../footprint/index.js';
import { signpostNetwork, signpostProbe } from '../../signposts/index.js';
import { seatBaseOf } from '../base.js';
import type { BuildOrderEntry } from '../build-order/entries.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { nearestLiveResource, reachableResourceTest } from '../live-resources.js';
import { anchorNodeOf, firstRingNode } from '../node-geometry.js';
import { ownedBuildings, ownedSettlers } from '../seat-roster.js';
import { COLLECTED_GOOD_IDS } from '../workforce/collectors/wanted-goods.js';

/**
 * The signpost lattice the scout tiles the settlement with (authored): the covered field grows with the
 * settlement instead of being laid out up front, and reaches out along corridors to the seat's work flags
 * and the deposits it gathers from, so a gatherer posted far out still walks inside his network.
 */

/** Hex distance between neighbouring lattice targets. With two posts each up to the tolerance off
 *  their targets the pair stays under the 40-node link range (22 + 2·8), and past the 16-node placement
 *  block when they drift together (22 - 2·8 is inside it, which the legal-spot search then steps
 *  around), so neighbouring posts chain into one network. */
export const SIGNPOST_LATTICE_SPACING_NODES = 22;

/** How far a post may stand from its lattice target and still satisfy it - also the legal-spot search
 *  reach, so an erected post always satisfies the target it was placed for. Under half the spacing,
 *  so one post can never satisfy two neighbouring targets. The search walks Manhattan rings, and a
 *  Manhattan step never counts less than a hex step, so the drift is bounded in hex distance too. */
export const SIGNPOST_TARGET_TOLERANCE_NODES = 8;

// Hex-lattice basis in node offsets: axial (q, r) ↦ (22q + 11r, 22r). A row step carries half a
// column, so the r step is a straight hex-grid direction and every neighbour pair sits exactly
// SIGNPOST_LATTICE_SPACING_NODES apart in hex distance.
const LATTICE_Q_DX = SIGNPOST_LATTICE_SPACING_NODES;
const LATTICE_R_DX = SIGNPOST_LATTICE_SPACING_NODES / 2;
const LATTICE_R_DY = SIGNPOST_LATTICE_SPACING_NODES;

/** Axial hex coordinate (q, r) → node offset from the lattice centre. */
export function signpostLatticeOffset(q: number, r: number): { dx: number; dy: number } {
  return { dx: LATTICE_Q_DX * q + LATTICE_R_DX * r, dy: LATTICE_R_DY * r };
}

/** The innermost hex ring: the centre post and this ring are always wanted, outer rings need a building
 *  nearby. */
const BASE_RING = 1;

/** The centre post aims one cell west of the base's door rather than at its anchor, which sits inside
 *  the blocked body and lets the legal-spot search settle on the doorway itself. One cell is two nodes
 *  on the half-cell lattice. */
const CENTRE_DOOR_CLEARANCE_NODES = 2;

/** Every ring-k target is exactly k spacings from the centre in hex distance, the lattice being aligned
 *  with the hex grid - the divisor bounding how many rings a settlement extent needs. */
const RING_STEP_NODES = SIGNPOST_LATTICE_SPACING_NODES;

/** Hard ring budget per decision (~217 targets scanned at worst). A settlement past it is the
 *  expansion module's concern, not lattice growth around the seat's base. */
const MAX_LATTICE_RING = 8;

/** How far apart the points a corridor is sampled at lie, in nodes: half the spacing, so no lattice
 *  target within the corridor's half width is missed between two samples. */
const CORRIDOR_SAMPLE_STEP_NODES = SIGNPOST_LATTICE_SPACING_NODES / 2;

/** How far from a corridor's line a lattice target is wanted, in hex nodes (authored): over the lattice's
 *  covering radius (a spacing over root three, under 13 nodes), so a corridor in any direction crosses a
 *  target on every ring, and under a spacing, so it takes that target and not the two beside it. */
const CORRIDOR_HALF_WIDTH_NODES = 16;

/** The axial walk tracing hex ring k counter-clockwise from its east corner (k, 0). */
const RING_WALK: readonly { q: number; r: number }[] = [
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
];

/** The axial coordinates of hex ring `k` in deterministic walk order (6k points; the centre for k=0). */
function latticeRing(k: number): { q: number; r: number }[] {
  if (k === 0) return [{ q: 0, r: 0 }];
  const out: { q: number; r: number }[] = [];
  let q = k;
  let r = 0;
  for (const d of RING_WALK) {
    for (let s = 0; s < k; s++) {
      out.push({ q, r });
      q += d.q;
      r += d.r;
    }
  }
  return out;
}

/** The outermost ring worth scanning for this settlement, from the farthest wanted point's hex distance. */
function latticeRingBound(anchor: HalfCellNode, points: readonly HalfCellNode[]): number {
  let extent = 0;
  for (const p of points) {
    const d = hexDistanceBetween(anchor.hx, anchor.hy, p.hx, p.hy);
    if (d > extent) extent = d;
  }
  const rings = Math.ceil((extent + SIGNPOST_LATTICE_SPACING_NODES) / RING_STEP_NODES);
  return Math.min(MAX_LATTICE_RING, Math.max(BASE_RING, rings));
}

/**
 * The points the corridor from `anchor` to `goal` is sampled at, every {@link CORRIDOR_SAMPLE_STEP_NODES}
 * along the straight run, the goal itself last. Integer-trunc ray projection, byte-identical across
 * engines.
 */
function corridorSamples(anchor: HalfCellNode, goal: HalfCellNode): HalfCellNode[] {
  const dx = goal.hx - anchor.hx;
  const dy = goal.hy - anchor.hy;
  const length = Math.abs(dx) + Math.abs(dy);
  const count = Math.max(1, Math.ceil(length / CORRIDOR_SAMPLE_STEP_NODES));
  const samples: HalfCellNode[] = [];
  for (let k = 1; k <= count; k++) {
    samples.push({
      hx: anchor.hx + Math.trunc((dx * k) / count),
      hy: anchor.hy + Math.trunc((dy * k) / count),
    });
  }
  return samples;
}

/**
 * The corridor goals the lattice reaches out to: every live work flag of the seat's settlers, and the
 * nearest live deposit on the base's ground of each good the seat gathers, the standing
 * {@link COLLECTED_GOOD_IDS} and the `order`'s collector goods, reached or not (authored): the network
 * grows toward a deposit before its gatherer is posted, since the engine drops a flag aimed past it.
 */
function corridorGoals(
  world: World,
  ctx: SystemContext,
  player: number,
  anchor: HalfCellNode,
  order: readonly BuildOrderEntry[],
): HalfCellNode[] {
  const goals: HalfCellNode[] = [];
  for (const e of ownedSettlers(world, player)) {
    const flag = liveWorkFlag(world, e);
    const node = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (node !== null) goals.push(node);
  }
  const terrain = ctx.terrain;
  if (terrain === undefined) return goals;
  const onOwnGround = reachableResourceTest(world, ctx, terrain, anchor, () => true);
  const goodIds = new Set(COLLECTED_GOOD_IDS);
  for (const entry of order) if (entry.kind === 'collector') goodIds.add(entry.good);
  for (const goodId of goodIds) {
    const good = goodTypeByContentId(ctx.content, goodId);
    if (good === undefined) continue;
    const resource = nearestLiveResource(world, good.typeId, anchor, onOwnGround);
    const node = resource === null ? null : anchorNodeOf(world, resource);
    if (node !== null) goals.push(node);
  }
  return goals;
}

/**
 * The next erectable lattice target for the seat: the first spot, rings inside-out, that is wanted (ring
 * within {@link BASE_RING}, an owned building within one lattice spacing, or a {@link corridorGoals}
 * corridor passing within {@link CORRIDOR_HALF_WIDTH_NODES}), has no own post within the tolerance, and
 * offers a legal node to erect
 * on. Null when the wanted lattice stands complete or every remaining target is unbuildable.
 */
export function nextSignpostTarget(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return null;
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return null;
  const door = interactionNode(world, ctx, base);
  const posts = signpostNetwork(world).get(player) ?? [];
  // Any construction state: coverage should arrive with a site, not after it finishes.
  const buildings: HalfCellNode[] = [];
  for (const e of ownedBuildings(world, player)) {
    const node = anchorNodeOf(world, e);
    if (node !== null) buildings.push(node);
  }
  const corridors = corridorGoals(world, ctx, player, anchor, order).map((goal) =>
    corridorSamples(anchor, goal),
  );
  const nearCorridor = (tx: number, ty: number): boolean =>
    corridors.some((samples) =>
      samples.some((p) => hexDistanceBetween(p.hx, p.hy, tx, ty) <= CORRIDOR_HALF_WIDTH_NODES),
    );
  let probe: ReturnType<typeof signpostProbe> | null = null;
  // The sealed-pocket veto: without it a provably sealed spot wins the search and the module re-aims at
  // it every decision. Judged from the base's door because the scout's own cell is unknowable in a
  // per-seat pick (approximation); a pocketed reference would invert the veto, so the pick then fails
  // open to the unvetoed search.
  let veto: ReturnType<typeof routeRegions> | null = null;
  const refNode =
    door !== null ? terrain.nodeAtClamped(door.x, door.y) : terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const maxRing = latticeRingBound(anchor, [...buildings, ...corridors.flat()]);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (const { q, r } of latticeRing(ring)) {
      const offset = signpostLatticeOffset(q, r);
      // Ring 0 rides the door, not the anchor, so the centre post ends up beside the entrance.
      const centre =
        ring === 0 && door !== null ? { hx: door.x - CENTRE_DOOR_CLEARANCE_NODES, hy: door.y } : anchor;
      const tx = centre.hx + offset.dx;
      const ty = centre.hy + offset.dy;
      const satisfied = posts.some(
        (s) => hexDistanceBetween(s.hx, s.hy, tx, ty) <= SIGNPOST_TARGET_TOLERANCE_NODES,
      );
      if (satisfied) continue;
      const wanted =
        ring <= BASE_RING ||
        buildings.some((b) => hexDistanceBetween(b.hx, b.hy, tx, ty) <= SIGNPOST_LATTICE_SPACING_NODES) ||
        nearCorridor(tx, ty);
      if (!wanted) continue;
      if (probe === null) {
        probe = signpostProbe(world, ctx.content, terrain, player);
        const regions = routeRegions(world, ctx, terrain);
        veto = regions.pocketed(refNode) ? null : regions;
      }
      const p = probe;
      const v = veto;
      // Never the doorway itself: a post there stands where the base's settlers enter and leave. The
      // region veto probes last, so a spot the cheap gates reject never costs a pocket flood.
      const spot = firstRingNode(
        tx,
        ty,
        SIGNPOST_TARGET_TOLERANCE_NODES,
        (x, y) =>
          p.canPlace(x, y) &&
          !(door !== null && x === door.x && y === door.y) &&
          (v === null || !v.unroutable(refNode, terrain.nodeAt(x, y))),
      );
      if (spot !== null) return spot;
    }
  }
  return null;
}
