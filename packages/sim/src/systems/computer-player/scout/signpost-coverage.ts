import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import { NO_COMPONENT } from '../../../nav/terrain/index.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf, firstRingNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { interactionNode, routeRegions } from '../../footprint/index.js';
import { signpostNetwork, signpostProbe } from '../../signposts/index.js';
import { seatBaseOf } from '../base.js';
import { type BuildOrder, orderSteps } from '../build-order/order/entries.js';
import {
  knownAnd,
  knownResourceTest,
  nearestLiveResource,
  reachableResourceTest,
} from '../live-resources.js';
import { COLLECTED_GOOD_IDS } from '../workforce/collectors/wanted-goods.js';
import { scoutLostZones } from './lost-zones.js';

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

/** How far a standing post may be from a lattice target and still be its neighbour's (hex nodes): one
 *  spacing plus the tolerance the post may drift off its own target, so the target extends the network
 *  that post belongs to. */
const LATTICE_LINK_NODES = SIGNPOST_LATTICE_SPACING_NODES + SIGNPOST_TARGET_TOLERANCE_NODES;

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
export function corridorSamples(anchor: HalfCellNode, goal: HalfCellNode): HalfCellNode[] {
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

/** The goods the seat gathers, by stable content id: the standing {@link COLLECTED_GOOD_IDS} and the
 *  `order`'s collector goods. */
export function gatheredGoodIds(order: BuildOrder): ReadonlySet<string> {
  const goodIds = new Set(COLLECTED_GOOD_IDS);
  for (const entry of orderSteps(order)) if (entry.kind === 'collector') goodIds.add(entry.good);
  return goodIds;
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
  order: BuildOrder,
): HalfCellNode[] {
  const goals: HalfCellNode[] = [];
  for (const e of homeSettlers(world, ctx, player)) {
    const flag = liveWorkFlag(world, e);
    const node = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (node !== null) goals.push(node);
  }
  const terrain = ctx.terrain;
  if (terrain === undefined) return goals;
  const onOwnGround = knownAnd(
    knownResourceTest(world, ctx, player),
    reachableResourceTest(world, ctx, terrain, anchor, () => true),
  );
  for (const goodId of gatheredGoodIds(order)) {
    const good = goodTypeByContentId(ctx.content, goodId);
    if (good === undefined) continue;
    const resource = nearestLiveResource(world, good.typeId, anchor, onOwnGround);
    const node = resource === null ? null : anchorNodeOf(world, resource);
    if (node !== null) goals.push(node);
  }
  return goals;
}

/** A wanted lattice target and its hex distance to the scout. */
interface LatticeTarget {
  readonly hx: number;
  readonly hy: number;
  readonly near: number;
}

/** Whether any of `points` lies within `radius` hex nodes of `(tx, ty)`. */
function anyWithin(points: readonly HalfCellNode[], tx: number, ty: number, radius: number): boolean {
  for (const p of points) if (hexDistanceBetween(p.hx, p.hy, tx, ty) <= radius) return true;
  return false;
}

/**
 * The next erectable lattice target for the seat: a spot that is wanted (ring within {@link BASE_RING},
 * an owned building within one lattice spacing, or a {@link corridorGoals} corridor passing within
 * {@link CORRIDOR_HALF_WIDTH_NODES}), has no own post within the tolerance, lies outside the zones the
 * seat lost a scout in ({@link scoutLostZones}), and offers a legal node to erect on. With the scout's
 * node `from`, the targets beside a standing post ({@link LATTICE_LINK_NODES}) and the centre come first,
 * nearest to him first, so he carries one corridor outward instead of crossing the settlement for each
 * ring (owner ruling: the scout picks the points close to him); the rest follow rings inside-out, the
 * whole order without `from`. Null when the wanted lattice stands complete or every remaining target is
 * unbuildable.
 */
export function nextSignpostTarget(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  from: HalfCellNode | null = null,
): HalfCellNode | null {
  const base = seatBaseOf(world, ctx, player);
  const anchor = base === null ? null : anchorNodeOf(world, base);
  if (base === null || anchor === null) return null;
  // Any construction state: coverage should arrive with a site, not after it finishes.
  const buildings: HalfCellNode[] = [];
  for (const e of homeBuildings(world, ctx, player)) {
    const node = anchorNodeOf(world, e);
    if (node !== null) buildings.push(node);
  }
  const corridors = corridorGoals(world, ctx, player, anchor, order).map((goal) =>
    corridorSamples(anchor, goal),
  );
  return signpostTargetAround(world, ctx, player, base, buildings, corridors, from);
}

/** {@link nextSignpostTarget} for the lattice laid out from `base`, wanted around `buildings` and along the
 *  `corridors`' sample nodes: a colony's own lattice uses its store and buildings. */
export function signpostTargetAround(
  world: World,
  ctx: SystemContext,
  player: number,
  base: Entity,
  buildings: readonly HalfCellNode[],
  corridors: readonly (readonly HalfCellNode[])[],
  from: HalfCellNode | null,
): HalfCellNode | null {
  const terrain = ctx.terrain;
  const anchor = anchorNodeOf(world, base);
  if (terrain === undefined || anchor === null) return null;
  const door = interactionNode(world, ctx, base);
  const posts = signpostNetwork(world).get(player) ?? [];
  const nearCorridor = (tx: number, ty: number): boolean => {
    for (const samples of corridors) if (anyWithin(samples, tx, ty, CORRIDOR_HALF_WIDTH_NODES)) return true;
    return false;
  };
  // The sealed-pocket veto: without it a provably sealed spot wins the search and the module re-aims at
  // it every decision. Judged from the base's door, which every scout walks from (approximation); a
  // pocketed reference would invert the veto, so the pick then fails open to the unvetoed search.
  const refNode =
    door !== null ? terrain.nodeAtClamped(door.x, door.y) : terrain.nodeAtClamped(anchor.hx, anchor.hy);
  // A spot on other land than the base, such as another island, is one the scout cannot walk to.
  const landmass = terrain.componentOf(refNode);
  const maxRing = latticeRingBound(anchor, [...buildings, ...corridors.flat()]);
  const lost = scoutLostZones(world, player, ctx.tick);
  // The probe and the region veto are built on the first target that needs them.
  let probe: ReturnType<typeof signpostProbe> | null = null;
  let veto: ReturnType<typeof routeRegions> | null | undefined;
  const spotFor = (tx: number, ty: number): HalfCellNode | null => {
    probe ??= signpostProbe(world, ctx.content, terrain, player);
    const placeable = probe;
    if (veto === undefined) {
      const regions = routeRegions(world, ctx, terrain);
      veto = regions.pocketed(refNode) ? null : regions;
    }
    const regionVeto = veto;
    // Never the doorway itself: a post there stands where the base's settlers enter and leave. The
    // region veto probes last, so a spot the cheap gates reject never costs a pocket flood.
    return firstRingNode(
      tx,
      ty,
      SIGNPOST_TARGET_TOLERANCE_NODES,
      (x, y) =>
        placeable.canPlace(x, y) &&
        !(door !== null && x === door.x && y === door.y) &&
        (landmass === NO_COMPONENT || terrain.componentOf(terrain.nodeAt(x, y)) === landmass) &&
        (regionVeto === null || !regionVeto.unroutable(refNode, terrain.nodeAt(x, y))),
    );
  };
  const linked: LatticeTarget[] = [];
  const unlinked: LatticeTarget[] = [];
  for (let ring = 0; ring <= maxRing; ring++) {
    for (const { q, r } of latticeRing(ring)) {
      const offset = signpostLatticeOffset(q, r);
      // Ring 0 rides the door, not the anchor, so the centre post ends up beside the entrance.
      const centre =
        ring === 0 && door !== null ? { hx: door.x - CENTRE_DOOR_CLEARANCE_NODES, hy: door.y } : anchor;
      const tx = centre.hx + offset.dx;
      const ty = centre.hy + offset.dy;
      if (anyWithin(posts, tx, ty, SIGNPOST_TARGET_TOLERANCE_NODES) || lost.node(tx, ty)) continue;
      const wanted =
        ring <= BASE_RING ||
        anyWithin(buildings, tx, ty, SIGNPOST_LATTICE_SPACING_NODES) ||
        nearCorridor(tx, ty);
      if (!wanted) continue;
      // Without a scout the ring order is the whole order: the first buildable target wins.
      if (from === null) {
        const spot = spotFor(tx, ty);
        if (spot !== null) return spot;
        continue;
      }
      const target = { hx: tx, hy: ty, near: hexDistanceBetween(from.hx, from.hy, tx, ty) };
      if (ring === 0 || anyWithin(posts, tx, ty, LATTICE_LINK_NODES)) linked.push(target);
      else unlinked.push(target);
    }
  }
  // A stable sort keeps the ring order among targets equally near.
  linked.sort((a, b) => a.near - b.near);
  for (const { hx, hy } of [...linked, ...unlinked]) {
    const spot = spotFor(hx, hy);
    if (spot !== null) return spot;
  }
  return null;
}
