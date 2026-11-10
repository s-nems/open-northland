import {
  Building,
  computerControllerRuns,
  mapBriefOf,
  Position,
  Resource,
  ResourceFootprint,
  Settler,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/blocked.js';
import { routeRegions } from '../footprint/index.js';
import { forEachResourceStanceBound, resourceStanceCells } from '../footprint/interaction.js';
import { needSubjectOf, settlerMeetsNeed } from '../progression/index.js';
import { interactionCell, jobAtomics } from '../settlers/targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import type { NavigationLimit } from '../signposts/index.js';
import { manhattan } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import {
  anyResourceNear,
  anyResourceOfGood,
  goodBoxHoldsAll,
  nearestResourceOfGood,
} from '../spatial/resources.js';
import { fogHides, playerSawNode } from '../vision/gates.js';

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

/** False only when no resource anchored on node `(hx, hy)`, a building aside, passes the
 *  {@link WorkableTest} it is paired with: a search tests it on the indexed anchor before reading the
 *  resource, so far candidates cost no component reads. */
export type AnchorGate = (hx: number, hy: number) => boolean;

/**
 * The deposits `seat` may know of, or null when it knows every one: a seat whose computer controller runs
 * under a fog that hides anything accepts a deposit on ground its own sight has reached (a RECON map's known
 * terrain shows no entities, so it does not count), and elsewhere only one that stood at the map brief's
 * scan, since the start layout is static knowledge (owner ruling on what a computer seat knows). A
 * deposit's remaining amount is still read live.
 */
export function knownResourceTest(world: World, ctx: SystemContext, seat: number): WorkableTest | null {
  const fog = ctx.fog;
  if (!fogHides(fog) || !computerControllerRuns(world, seat)) return null;
  const ceiling = mapBriefOf(world)?.entityCeiling ?? 0;
  return (e) => {
    if (e < ceiling) return true;
    const node = anchorNodeOf(world, e);
    return node !== null && playerSawNode(fog, seat, node.hx, node.hy);
  };
}

/** `workable` narrowed to the deposits `known` accepts; `workable` itself when every deposit is known. */
export function knownAnd(known: WorkableTest | null, workable?: WorkableTest): WorkableTest | undefined {
  if (known === null) return workable;
  return workable === undefined ? known : (e) => known(e) && workable(e);
}

/** The decision's {@link WorkableTest}: some stance cell of the resource lies clear of the live walk-block
 *  overlay, so a deposit a building has buried whole no longer counts. A gatherer tests only the stance cell
 *  nearest itself, so a partly buried one can still pass here. A node without a footprint is workable. */
export function workableResourceTest(world: World, ctx: SystemContext, terrain: TerrainGraph): WorkableTest {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  return (e) => {
    if (!world.has(e, ResourceFootprint)) return true;
    for (const cell of resourceStanceCells(world, ctx, terrain, e)) if (!blocked.has(cell)) return true;
    return false;
  };
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

/** {@link reachableResourceTest}'s {@link AnchorGate}: a passing resource's work cell lies on `from`'s
 *  component, at most `maxResourceWorkOffset` Manhattan nodes from its anchor, so its anchor lies inside the
 *  component's box widened by that. None when every resource passes the component test. */
export function reachableResourceGate(
  ctx: SystemContext,
  terrain: TerrainGraph,
  from: HalfCellNode,
): AnchorGate | undefined {
  const component = terrain.componentOf(terrain.nodeAtClamped(from.hx, from.hy));
  if (component === NO_COMPONENT) return undefined;
  const box = terrain.componentBounds(component);
  const slack = contentIndex(ctx.content).maxResourceWorkOffset;
  const minX = box.minX - slack;
  const maxX = box.maxX + slack;
  const minY = box.minY - slack;
  const maxY = box.maxY + slack;
  return (hx, hy) => hx >= minX && hx <= maxX && hy >= minY && hy <= maxY;
}

/** The {@link AnchorGate} of a test that lets a resource be worked only when `limit` allows its work cell,
 *  at most `maxResourceWorkOffset` Manhattan nodes from its anchor; none for a limit that cannot tell. */
export function limitResourceGate(
  ctx: SystemContext,
  terrain: TerrainGraph,
  limit: NavigationLimit | null,
): AnchorGate | undefined {
  const mayAllowNear = limit?.mayAllowNear?.bind(limit);
  if (mayAllowNear === undefined) return undefined;
  const slack = contentIndex(ctx.content).maxResourceWorkOffset;
  return (hx, hy) => !terrain.inBounds(hx, hy) || mayAllowNear(hx, hy, slack);
}

/** The gate of a test that is both `a`'s and `b`'s. */
export function bothGates(a: AnchorGate | undefined, b: AnchorGate | undefined): AnchorGate | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return (hx, hy) => a(hx, hy) && b(hx, hy);
}

/**
 * Whether a resource's work cell lies on `component` whatever origin picks it, or null when the pick
 * decides. The work cell is one of the resource's stance cells, or its anchor when none can be entered
 * (`resourceWorkCell`), so a pool and anchor wholly on or wholly off the component settle the verdict
 * without the nearest-stance pick and its pocket floods. The static {@link stanceBoundOf} settles most
 * resources before the live pool is read.
 */
function stanceComponentVerdict(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  component: number,
): boolean | null {
  // A building's door is its interaction cell, and the pick below is the resource rule alone.
  if (world.has(e, Building) || !world.has(e, Resource) || !world.has(e, Position)) return null;
  const bound = stanceBoundOf(world, terrain, e);
  const anchorOn = bound.anchor === component;
  // The pool is a subset of the bound, so a bound wholly on or off the component settles it.
  if (bound.cells === EMPTY_BOUND) return anchorOn;
  if (bound.cells !== MIXED_BOUND) {
    const boundOn = bound.cells === component;
    if (anchorOn === boundOn) return anchorOn;
  }
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

/** {@link StanceBound.cells} of a resource whose stance bound is empty. */
const EMPTY_BOUND = -2;
/** {@link StanceBound.cells} of a resource whose stance bound spans several components. */
const MIXED_BOUND = -3;

/** The static components around a resource: its anchor's, and the one every cell of its stance bound
 *  (`forEachResourceStanceBound`) shares, or {@link EMPTY_BOUND} / {@link MIXED_BOUND}. */
interface StanceBound {
  position: number | undefined;
  footprint: number | undefined;
  anchor: number;
  cells: number;
}

/** Resources' bounds kept before the cache is dropped wholesale, so the ids of felled resources cannot
 *  accumulate without bound (a memory bound only: a dropped bound is re-derived). */
const MAX_HELD_STANCE_BOUNDS = 16384;

/** Derived read state per world and terrain, each bound keyed on the resource's Position and
 *  ResourceFootprint revisions, the only world state it reads. Revisions count per world, so the cache
 *  must not be shared between worlds. Never hashed or saved. */
const stanceBoundsByWorld = new WeakMap<
  World,
  { readonly terrain: TerrainGraph; readonly bounds: Map<Entity, StanceBound> }
>();

function stanceBoundOf(world: World, terrain: TerrainGraph, e: Entity): StanceBound {
  let held = stanceBoundsByWorld.get(world);
  if (held === undefined || held.terrain !== terrain) {
    held = { terrain, bounds: new Map() };
    stanceBoundsByWorld.set(world, held);
  }
  const { bounds } = held;
  const position = world.revisionOf(e, Position);
  const footprint = world.revisionOf(e, ResourceFootprint);
  const kept = bounds.get(e);
  if (kept !== undefined && kept.position === position && kept.footprint === footprint) return kept;
  if (kept === undefined && bounds.size >= MAX_HELD_STANCE_BOUNDS) bounds.clear();
  const p = world.get(e, Position);
  const anchor = terrain.componentOf(
    terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y)),
  );
  let cells = EMPTY_BOUND;
  forEachResourceStanceBound(world, terrain, e, (cell) => {
    const label = terrain.componentOf(cell);
    if (cells === EMPTY_BOUND) cells = label;
    else if (cells !== label) cells = MIXED_BOUND;
  });
  const bound: StanceBound = { position, footprint, anchor, cells };
  bounds.set(e, bound);
  return bound;
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

/** `known` narrows the resources a computer seat's holder takes to those it may know of
 *  ({@link knownResourceTest}); null for a reader that sees them all. */
export function gathererReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  known: WorkableTest | null = null,
): GathererReach {
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
        if (known !== null && !known(e)) return false;
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
 * map and a good that stands only far away never pays for the others. `gate` is `workable`'s
 * {@link AnchorGate}, when it has one.
 */
export function nearestLiveResource(
  world: World,
  goodType: number,
  from: HalfCellNode,
  workable?: WorkableTest,
  gate?: AnchorGate,
): Entity | null {
  const accept = (e: Entity, hx: number, hy: number): boolean =>
    (gate === undefined || gate(hx, hy) || world.has(e, Building)) &&
    world.get(e, Resource).remaining > 0 &&
    (workable === undefined || workable(e));
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

/** Whether a standing not-yet-empty `goodType` resource that `workable` accepts lies within `nodes`
 *  Manhattan nodes of `from`: one search of the box round that diamond, however far the good stands past
 *  it. */
export function liveResourceWithin(
  world: World,
  goodType: number,
  from: HalfCellNode,
  nodes: number,
  workable?: WorkableTest,
): boolean {
  const accept = (e: Entity): boolean =>
    world.get(e, Resource).remaining > 0 && (workable === undefined || workable(e));
  const hit = nearestResourceOfGood(world, goodType, from.hx, from.hy, nodes, undefined, accept);
  return hit !== null && hit.distance <= nodes;
}

/** {@link nearestLiveResource} over several goods: the nearest of the goods' winners, ties to the lower
 *  entity id. */
export function nearestLiveResourceOfGoods(
  world: World,
  goodTypes: readonly number[],
  from: HalfCellNode,
  workable?: WorkableTest,
  gate?: AnchorGate,
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const goodType of goodTypes) {
    const hit = nearestLiveResource(world, goodType, from, workable, gate);
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

/** Whether any not-yet-empty resource of `goodType` that `known` accepts stands on the map. */
export function anyLiveResource(world: World, goodType: number, known: WorkableTest | null = null): boolean {
  return anyResourceOfGood(
    world,
    goodType,
    (e) => isLiveResource(world, e, goodType) && (known === null || known(e)),
  );
}
