import { Building, Position, Resource, ResourceFootprint, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { routeRegions } from '../footprint/index.js';
import { resourceStanceCells } from '../footprint/interaction.js';
import { needSubjectOf, settlerMeetsNeed } from '../progression/index.js';
import { interactionCell, jobAtomics } from '../settlers/targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { manhattan } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import {
  anyResourceNear,
  canonicalResources,
  goodBoxHoldsAll,
  nearestResourceOfGood,
  resourceBoxHoldsAll,
} from '../spatial/resources.js';
import { anchorNodeOf } from './node-geometry.js';

/** The first expanding-box reach of the live-resource searches below (Chebyshev half-cell nodes). */
const RESOURCE_BOX_REACH_START = 16;
/**
 * The largest box walked before the live-resource searches fall back to the whole-map reference
 * scan. The cap only bounds the cost of a hopeless neighbourhood - the fallback reproduces the
 * exact linear winner past it (authored; the `RING_MAX_RADIUS` convention).
 */
const RESOURCE_BOX_REACH_MAX = 512;

/** Whether a gatherer can still stand to work a resource. */
export type WorkableTest = (e: Entity) => boolean;

/** The decision's {@link WorkableTest}: some stance cell of the resource lies clear of the live walk-block
 *  overlay, so a deposit a building has buried whole no longer counts. A gatherer tests only the stance cell
 *  nearest itself, so a partly buried one can still pass here. A node without a footprint is workable. */
export function workableResourceTest(world: World, ctx: SystemContext, terrain: TerrainGraph): WorkableTest {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  return (e) =>
    !world.has(e, ResourceFootprint) ||
    resourceStanceCells(world, ctx, terrain, e).some((cell) => !blocked.has(cell));
}

/**
 * The {@link WorkableTest} that also drops every resource whose work cell nearest `from` lies on another
 * walkable component than `from` itself: a deposit across water is no gatherer's from this seat. Every
 * search for the resource nearest an anchor reads it, so neither a hire nor a re-plant aims a flag at
 * ground the holder cannot walk to. Every resource passes when `from` is not walkable.
 */
export function reachableResourceTest(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: HalfCellNode,
  workable: WorkableTest,
): WorkableTest {
  const origin = terrain.nodeAtClamped(from.hx, from.hy);
  const component = terrain.componentOf(origin);
  if (component === NO_COMPONENT) return workable;
  return (e) =>
    workable(e) &&
    (stanceComponentVerdict(world, ctx, terrain, e, component) ??
      terrain.componentOf(interactionCell(world, ctx, terrain, e, origin)) === component);
}

/**
 * Whether a resource's work cell lies on `component` whatever origin picks it, or null when the pick
 * decides. The work cell is one of the resource's stance cells, or its anchor when none can be entered
 * (`resourceWorkCell`), so a pool and anchor wholly on or wholly off the component settle the verdict
 * without the nearest-stance pick and its pocket floods.
 */
function stanceComponentVerdict(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  component: number,
): boolean | null {
  // A building's door is its interaction cell, and the pick below is the resource rule alone.
  if (world.has(e, Building) || !world.has(e, Resource)) return null;
  const p = world.tryGet(e, Position);
  if (p === undefined) return null;
  const anchor = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  const anchorOn = terrain.componentOf(anchor) === component;
  let anyOn = false;
  let allOn = true;
  for (const cell of resourceStanceCells(world, ctx, terrain, e)) {
    if (terrain.componentOf(cell) === component) anyOn = true;
    else allOn = false;
  }
  if (anchorOn && allOn) return true;
  if (!anchorOn && !anyOn) return false;
  return null;
}

/**
 * A flag gatherer's own harvest filters, judged from his flag node as if he idled there: his trade's
 * atomic, the good's experience need, and the work cell nearest the flag lying inside the circle, clear of
 * the live overlay, on the flag's side of any terrain seam, off his failed-route memo and routable. The
 * settler planner's harvest search needs a whole planner pass, so its filters are restated here. Signpost
 * confinement is left out: the seat plants its flags inside its own network.
 *
 * The flag must also share the holder's own walkable component, or he could never walk to it; a holder
 * with no Position or on an unwalkable node is judged from the flag alone. A flag inside a sealed pocket
 * stands in for the walker, so it drops the route veto rather than inverting it.
 */
export interface GathererReach {
  /** Whether `holder` with a flag of `radius` on `flag` would take `resource`. */
  canWork(holder: Entity, flag: HalfCellNode, radius: number, resource: Entity): boolean;
  /** Whether any live resource of a good `wanted` accepts is one {@link canWork} takes. */
  patchHarvestable(
    holder: Entity,
    flag: HalfCellNode,
    radius: number,
    wanted: (goodType: number) => boolean,
  ): boolean;
  /** {@link patchHarvestable}'s proof: a live resource of a good `wanted` accepts that {@link canWork}
   *  takes, or null when none is. Which one is a hint that varies with the search history. */
  patchWitness(
    holder: Entity,
    flag: HalfCellNode,
    radius: number,
    wanted: (goodType: number) => boolean,
  ): Entity | null;
}

const NO_ATOMICS: ReadonlySet<number> = new Set();

export function gathererReach(world: World, ctx: SystemContext, terrain: TerrainGraph): GathererReach {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const regions = routeRegions(world, ctx, terrain);
  const judge = (holder: Entity) => {
    const jobType = world.get(holder, Settler).jobType;
    const allowed = jobType === null ? NO_ATOMICS : jobAtomics(ctx, jobType);
    const subject = needSubjectOf(world, holder);
    const memo = unreachableGoals(world, ctx, holder);
    const needMet = new Map<number, boolean>();
    const holderNode = world.has(holder, Position) ? entityNode(world, terrain, holder) : null;
    // One flag centre per call, so its pocket verdict is read once rather than per candidate.
    let sealedCenter: NodeId | null = null;
    let sealed = false;
    const centerPocketed = (center: NodeId): boolean => {
      if (center !== sealedCenter) {
        sealed = regions.pocketed(center);
        sealedCenter = center;
      }
      return sealed;
    };
    return {
      allowed,
      /** Whether the holder can walk to a flag on `center` at all, not across static terrain nor into or
       *  out of a sealed pocket; the per-resource test assumes it. */
      reachesFlag: (center: NodeId): boolean =>
        holderNode === null ||
        (terrain.componentOf(center) === terrain.componentOf(holderNode) &&
          !regions.unroutable(holderNode, center)),
      takes: (center: NodeId, radius: number, e: Entity, wanted: (goodType: number) => boolean): boolean => {
        const res = world.get(e, Resource);
        if (res.remaining <= 0 || !wanted(res.goodType) || !allowed.has(res.harvestAtomic)) return false;
        let met = needMet.get(res.goodType);
        if (met === undefined) {
          met = settlerMeetsNeed(world, ctx, subject, 'good', res.goodType);
          needMet.set(res.goodType, met);
        }
        if (!met) return false;
        const cell = interactionCell(world, ctx, terrain, e, center);
        if (manhattan(terrain, center, cell) > radius) return false;
        if (terrain.componentOf(cell) !== terrain.componentOf(center)) return false;
        if (cell !== center && (blocked.has(cell) || isUnreachableGoal(memo, cell))) return false;
        return centerPocketed(center) || !regions.unroutable(center, cell);
      },
    };
  };
  const centerOf = (flag: HalfCellNode): NodeId => terrain.nodeAtClamped(flag.hx, flag.hy);
  return {
    canWork: (holder, flag, radius, resource) => {
      const { reachesFlag, takes } = judge(holder);
      const center = centerOf(flag);
      return reachesFlag(center) && takes(center, radius, resource, () => true);
    },
    patchHarvestable: (holder, flag, radius, wanted) => patchWitness(holder, flag, radius, wanted) !== null,
    patchWitness,
  };

  function patchWitness(
    holder: Entity,
    flag: HalfCellNode,
    radius: number,
    wanted: (goodType: number) => boolean,
  ): Entity | null {
    const { allowed, reachesFlag, takes } = judge(holder);
    const center = centerOf(flag);
    if (!reachesFlag(center)) return null;
    const reach = radius + contentIndex(ctx.content).maxResourceWorkOffset;
    const witnesses = patchWitnesses(world);
    const witness = witnesses.get(holder);
    if (
      witness !== undefined &&
      world.has(witness, Resource) &&
      inBox(world, witness, flag, reach) &&
      takes(center, radius, witness, wanted)
    ) {
      return witness;
    }
    let found: Entity | undefined;
    anyResourceNear(
      world,
      flag.hx,
      flag.hy,
      reach,
      (e) => {
        if (!takes(center, radius, e, wanted)) return false;
        found = e;
        return true;
      },
      allowed,
    );
    if (found === undefined) witnesses.delete(holder);
    else witnesses.set(holder, found);
    return found ?? null;
  }
}

/**
 * The resource that last proved each holder's patch harvestable, tried first on the next decision. The
 * verdict is existence only, and a witness that passes the same filters inside the same box is one of
 * the candidates the scan would accept, so the hint changes the cost and never the answer. Derived read
 * state, never hashed or saved. An entry outlives its holder: entity ids are never reused, so a stale one
 * costs memory, one entry per holder ever checked.
 */
const patchWitnessesByWorld = new WeakMap<World, Map<Entity, Entity>>();

function patchWitnesses(world: World): Map<Entity, Entity> {
  let witnesses = patchWitnessesByWorld.get(world);
  if (witnesses === undefined) {
    witnesses = new Map();
    patchWitnessesByWorld.set(world, witnesses);
  }
  return witnesses;
}

/** Whether `e` stands inside the Chebyshev `reach` box around `from`, the box the region scan walks. */
function inBox(world: World, e: Entity, from: HalfCellNode, reach: number): boolean {
  const node = anchorNodeOf(world, e);
  return node !== null && Math.abs(node.hx - from.hx) <= reach && Math.abs(node.hy - from.hy) <= reach;
}

/** Whether `e` is a standing not-yet-empty resource of `goodType`. */
function isLiveResource(world: World, e: Entity, goodType: number): boolean {
  const r = world.get(e, Resource);
  return r.goodType === goodType && r.remaining > 0;
}

/**
 * The standing not-yet-empty resource of `goodType` nearest to `from` (Manhattan node distance,
 * ties to the lower entity id) that `workable` accepts, or null when the map holds none. Expanding boxes
 * over the good's own region buckets, so a decision near a stocked neighbourhood never walks the whole
 * map and a good that stands only far away never pays for the others.
 */
export function nearestLiveResource(
  world: World,
  goodType: number,
  from: HalfCellNode,
  workable?: WorkableTest,
): Entity | null {
  const accept = (e: Entity): boolean =>
    world.get(e, Resource).remaining > 0 && (workable === undefined || workable(e));
  let searched: number | undefined; // the largest box that held no candidate; later boxes skip its members
  for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
    const hit = nearestResourceOfGood(world, goodType, from.hx, from.hy, reach, searched, accept);
    if (hit === null) {
      // A miss in a box holding every node of the good is final, so a far or absent good stops here.
      if (goodBoxHoldsAll(world, goodType, from.hx, from.hy, reach)) return null;
      searched = reach;
      continue;
    }
    // A winner at Manhattan ≤ reach is global: every node outside the Chebyshev `reach` box lies at
    // Manhattan ≥ reach+1, so nothing outside can beat or tie it.
    if (hit.distance <= reach) return hit.entity;
    // Only a box-corner hit (Manhattan up to 2·reach): every node at Manhattan ≤ hit.distance lies
    // inside the Chebyshev `hit.distance` box, so one exact re-query settles the winner.
    const exact = nearestResourceOfGood(world, goodType, from.hx, from.hy, hit.distance, searched, accept);
    return (exact ?? hit).entity;
  }
  // Nothing within the cap - folding the good's whole partition finds the winner the uncapped search would.
  return (
    nearestResourceOfGood(world, goodType, from.hx, from.hy, undefined, undefined, accept)?.entity ?? null
  );
}

/** {@link nearestLiveResource} over several goods: the nearest of the goods' winners, ties to the lower
 *  entity id. */
export function nearestLiveResourceOfGoods(
  world: World,
  goodTypes: readonly number[],
  from: HalfCellNode,
  workable?: WorkableTest,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const goodType of goodTypes) {
    const hit = nearestLiveResource(world, goodType, from, workable);
    const node = hit === null ? null : anchorNodeOf(world, hit);
    if (hit === null || node === null) continue;
    const distance = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (distance < bestDistance || (distance === bestDistance && best !== null && hit < best)) {
      best = hit;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Whether any not-yet-empty resource of `goodType` stands on the map - existence only, so the first
 * box holding a live node answers without ranking it. `near` seeds the expanding-box search (the
 * seat's base - collector goods are gathered around it). A miss in a box holding every resource decides
 * a dry map; a null seed or a miss within the cap falls back to the early-exit canonical scan.
 */
export function anyLiveResource(world: World, goodType: number, near: HalfCellNode | null): boolean {
  if (near !== null) {
    for (let reach = RESOURCE_BOX_REACH_START; reach <= RESOURCE_BOX_REACH_MAX; reach *= 2) {
      if (anyResourceNear(world, near.hx, near.hy, reach, (e) => isLiveResource(world, e, goodType))) {
        return true;
      }
      if (resourceBoxHoldsAll(world, near.hx, near.hy, reach)) return false;
    }
  }
  for (const e of canonicalResources(world)) {
    if (isLiveResource(world, e, goodType)) return true;
  }
  return false;
}
