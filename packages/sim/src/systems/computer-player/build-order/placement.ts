import { BUILDING_KIND, type BuildingType, type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Stockpile } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween, nodeManhattan } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../nav/terrain/index.js';
import { type SpotAcceptor, spotAcceptor } from '../../ai-shared/building-spot.js';
import {
  buildingTypeByContentId,
  countedTiers,
  goodTypeByContentId,
  tiersAtOrAbove,
} from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import {
  anchorCentroid,
  anchorNodeOf,
  bestRingNode,
  firstRingNode,
  towardNode,
} from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf } from '../../footprint/geometry.js';
import { placementBlockerGrid } from '../../footprint/placement/blocker-grid.js';
import { shipYardProbe } from '../../footprint/placement/vehicle-site.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBaseOf } from '../base.js';
import { SHIP_JOINERY_SHORE_RINGS, smallestShipHouse } from '../joinery-role.js';
import { knownResourceTest, nearestLiveResource } from '../live-resources.js';
import { coastsOf, nearestEnemyBuilding, seaRouteOf } from '../sea-route.js';
import type { BuildOrderEntry, PlacementAffinity } from './entries.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES, overflowBuildReachNodes } from './entries.js';
import { scriptedFrontLine } from './front.js';
import { grassBound } from './grass-reserve.js';
import { seatTuning } from './seat-order.js';

/** One affinity other than `shore` ({@link shoreTarget}) resolved to a node, or null when it cannot be. A
 *  `building` affinity takes the seat's lowest-id building of that id or a tier above it, so the pick is
 *  deterministic and an upgraded workshop still anchors; when the entry's `unlessWithin` names the same
 *  id, it takes the first such building with none of the entry's counted kind in reach, the one the
 *  placement exists to serve. A `resource` deposit is the one nearest `from`. */
function affinityNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  from: HalfCellNode,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  affinity: Exclude<PlacementAffinity, { kind: 'shore' }>,
): HalfCellNode | null {
  switch (affinity.kind) {
    case 'building': {
      const index = contentIndex(ctx.content);
      const near = entry.unlessWithin;
      const chosen =
        near !== undefined && near.building === affinity.id
          ? unservedAnchor(world, index, owned, countedTiers(ctx.content, type, entry.belowTier), near)
          : anchorsOfId(world, index, owned, affinity.id)[0];
      return chosen === undefined || chosen === null ? null : anchorNodeOf(world, chosen);
    }
    case 'resource': {
      const good = goodTypeByContentId(ctx.content, affinity.good);
      if (good === undefined) return null;
      const known = knownResourceTest(world, ctx, player) ?? undefined;
      const resource = nearestLiveResource(world, good.typeId, from, known);
      return resource === null
        ? stockedStoreNode(world, ctx, owned, good.typeId)
        : anchorNodeOf(world, resource);
    }
    case 'mapCentre':
      return mapCentreNode(terrain);
    case 'front':
      // The pull points down the road the attacks come by rather than at the middle of the map.
      return frontEdgeNode(
        world,
        owned,
        anchor,
        nearestEnemyBuilding(world, ctx, player, anchor)?.node ?? mapCentreNode(terrain),
      );
  }
}

/** How near its ship water a `shore` placement's anchor stands, in hex rings. */
const SHORE_SPOT_RINGS = SHIP_JOINERY_SHORE_RINGS;

/** How far out from the base the `shore` affinity looks for ship water, in Manhattan nodes: the
 *  placement's own search fan, since the spot must still land in the settlement's reach. */
const SHORE_SEARCH_RADIUS_NODES = 2 * BUILD_SEARCH_MAX_RADIUS_NODES;

/** The Manhattan span of the hex rings under {@link SHORE_SPOT_RINGS} on the half-cell lattice, where a
 *  hex step moves two nodes across or one across and one row: 14 for 10 rings, found by enumeration. */
const SHORE_SPOT_SPAN_NODES = Math.ceil((3 * SHORE_SPOT_RINGS) / 2);

/** The static land component of the seat's base interaction cell, as {@link seaRouteOf} reads it, or
 *  {@link NO_COMPONENT} for a seat with no base. */
function baseComponent(world: World, ctx: SystemContext, terrain: TerrainGraph, player: number): number {
  const base = seatBaseOf(world, ctx, player);
  return base === null ? NO_COMPONENT : terrain.componentOf(interactionCell(world, ctx, terrain, base));
}

/**
 * The `shore` target: the water node nearest `anchor` on the lattice's rings where a yard of the content's
 * smallest ship fits with its door on the seat's home continent ({@link shipYardProbe}), in a body
 * bordering that continent, with a spot `accept` takes inside the seat's reach within
 * {@link SHORE_SPOT_RINGS}. The yard's door stands south of its hull, so only shore with the water to its
 * north admits one. A body that also borders the
 * continent of the rival headquarters over the sea is taken first. The home continent is the sea route's
 * while one exists, else the base's, read the same way. Null when no such water lies within
 * {@link SHORE_SEARCH_RADIUS_NODES}.
 */
function shoreTarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  accept: (x: number, y: number) => boolean,
): { readonly node: HalfCellNode; readonly home: number } | null {
  const route = seaRouteOf(world, ctx, player);
  const home = route?.home ?? baseComponent(world, ctx, terrain, player);
  const house = smallestShipHouse(contentIndex(ctx.content));
  const yardFits =
    house === null || home === NO_COMPONENT ? null : shipYardProbe(world, ctx, terrain, house, tribe, home);
  if (yardFits === null) return null;
  const coasts = coastsOf(terrain);
  const ours = coasts.get(home);
  if (ours === undefined) return null;
  const theirs = route === null ? undefined : coasts.get(route.rival);
  const reach = buildReach(world, owned, anchor);
  // Neighbouring water nodes share most of their discs, so each land node is tested once a search.
  const taken = new Map<NodeId, boolean>();
  const takes = (x: number, y: number): boolean => {
    const node = terrain.nodeAt(x, y);
    const known = taken.get(node);
    if (known !== undefined) return known;
    const ok = reach.contains(x, y) && accept(x, y);
    taken.set(node, ok);
    return ok;
  };
  const spotBeside = (wx: number, wy: number) =>
    firstRingNode(
      wx,
      wy,
      SHORE_SPOT_SPAN_NODES,
      (x, y) =>
        hexDistanceBetween(wx, wy, x, y) < SHORE_SPOT_RINGS &&
        terrain.inBounds(x, y) &&
        terrain.componentOf(terrain.nodeAt(x, y)) === home &&
        takes(x, y),
    ) !== null;
  const sailable = (bodies: ReadonlySet<number>) => (x: number, y: number) => {
    if (!terrain.inBounds(x, y)) return false;
    const node = terrain.nodeAt(x, y);
    if (!terrain.isWater(node)) return false;
    const body = terrain.componentOf(node);
    if (!ours.has(body) || !bodies.has(body)) return false;
    return reach.meets({ hx: x, hy: y }, SHORE_SPOT_RINGS) && yardFits(x, y) && spotBeside(x, y);
  };
  const across =
    theirs === undefined
      ? null
      : firstRingNode(anchor.hx, anchor.hy, SHORE_SEARCH_RADIUS_NODES, sailable(theirs));
  const node = across ?? firstRingNode(anchor.hx, anchor.hy, SHORE_SEARCH_RADIUS_NODES, sailable(ours));
  return node === null ? null : { node, home };
}

/** How far past the settlement's front-most building a `front` placement aims, in Manhattan nodes
 *  (authored): on the settlement's edge toward the enemy, never a whole reach out from it. */
export const FRONT_EDGE_STEP_NODES = 8;

/**
 * The settlement's edge toward `target`: the seat's building nearest it (the lowest id on a tie, `owned`
 * walking ascending), or `anchor` while none has a node, pushed {@link FRONT_EDGE_STEP_NODES} toward it.
 * Aimed at the enemy itself, the pull would land a whole reach past the nearest building, and each
 * building raised there would carry the next one further, until two seats' barracks met mid-map.
 */
function frontEdgeNode(
  world: World,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  target: HalfCellNode,
): HalfCellNode {
  let edge = anchor;
  let edgeDistance = Number.POSITIVE_INFINITY;
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const distance = nodeManhattan(node, target);
    if (distance < edgeDistance) {
      edge = node;
      edgeDistance = distance;
    }
  }
  return towardNode(edge, target, FRONT_EDGE_STEP_NODES);
}

/** The seat's store holding the most units of the good, the lowest id on a tie, as a node, or null while
 *  none holds any: a workshop drawing on a good the map no longer offers stands beside the stock of it
 *  instead (authored), as a late smithy does by the mined iron once the deposits are dug out. */
function stockedStoreNode(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  goodType: number,
): HalfCellNode | null {
  const index = contentIndex(ctx.content);
  let best: Entity | null = null;
  let most = 0;
  for (const e of owned) {
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'storage') continue;
    const units = world.tryGet(e, Stockpile)?.amounts.get(goodType) ?? 0;
    if (units > most) {
      best = e;
      most = units;
    }
  }
  return best === null ? null : anchorNodeOf(world, best);
}

/** The seat's buildings of the content id or a tier above it, canonical ascending; none for an unknown id. */
function anchorsOfId(world: World, index: ContentIndex, owned: readonly Entity[], id: string): Entity[] {
  const typeId = index.buildingTypeBySlug.get(id);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  if (type === undefined) return [];
  const chain = tiersAtOrAbove(index, type);
  return owned.filter((e) => chain.has(world.get(e, Building).buildingType));
}

/**
 * The seat's lowest-id `near.building` (or a tier above it) with no building of a `counted` type within
 * `near.radius` world-metric nodes, or null when every one has, or when the seat has none. The entry's
 * `unlessWithin` skip and its placement centre read the same pick, so the well it raises lands beside the
 * workshop that lacked one.
 */
export function unservedAnchor(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  counted: ReadonlySet<number>,
  near: { readonly building: string; readonly radius: number },
): Entity | null {
  const served: HalfCellNode[] = [];
  for (const e of owned) {
    if (!counted.has(world.get(e, Building).buildingType)) continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) served.push(node);
  }
  for (const e of anchorsOfId(world, index, owned, near.building)) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    if (!served.some((s) => withinNodeRadius(node.hx, node.hy, s.hx, s.hy, near.radius))) return e;
  }
  return null;
}

function mapCentreNode(terrain: TerrainGraph): HalfCellNode {
  return { hx: Math.floor(terrain.width / 2), hy: Math.floor(terrain.height / 2) };
}

/** Where the spot must land beyond the reach and the acceptor, or null for anywhere. */
type SpotBound = ((x: number, y: number) => boolean) | null;

/** How far past a field farm's field radius a home keeps off the farm's anchor, in Manhattan nodes
 *  (authored, owner ruling: room beside the grain farm stays for the mill and the animal farm that use its
 *  grain, and beside the mill for the bakery): about one workshop's footprint beyond the fields. */
export const HOME_FARM_MARGIN_NODES = 6;

/** How far a home's search centre moves off the base anchor, away from the seat's field farms, in
 *  Manhattan nodes (authored, owner ruling: the homes go up on the other side of the base from the farm
 *  and need to stand beside nothing): a little over a third of the build reach, so the homes stay close. */
export const HOME_FAR_SIDE_PUSH_NODES = 12;

const fieldRadiusCache = new WeakMap<ContentSet, ReadonlyMap<number, number>>();

/** The building types that sow fields (a `produces` good with a `farming` block: the grain farm, the herb
 *  hut), with their widest field radius. */
function fieldRadiusByType(content: ContentSet): ReadonlyMap<number, number> {
  let radii = fieldRadiusCache.get(content);
  if (radii === undefined) {
    const index = contentIndex(content);
    const built = new Map<number, number>();
    for (const type of content.buildings) {
      for (const good of type.produces) {
        const radius = index.goods.get(good)?.farming?.fieldRadius;
        if (radius !== undefined) built.set(type.typeId, Math.max(radius, built.get(type.typeId) ?? 0));
      }
    }
    radii = built;
    fieldRadiusCache.set(content, radii);
  }
  return radii;
}

/** The seat's field farms, sites included, with their anchors and field radii. */
function fieldFarms(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
): { readonly e: Entity; readonly node: HalfCellNode; readonly radius: number }[] {
  const radii = fieldRadiusByType(ctx.content);
  const farms: { e: Entity; node: HalfCellNode; radius: number }[] = [];
  if (radii.size === 0) return farms;
  for (const e of owned) {
    const radius = radii.get(world.get(e, Building).buildingType);
    const node = radius === undefined ? null : anchorNodeOf(world, e);
    if (radius !== undefined && node !== null) farms.push({ e, node, radius });
  }
  return farms;
}

/** Where a home without affinities looks (owner ruling): its search centre pushed
 *  {@link HOME_FAR_SIDE_PUSH_NODES} from `anchor` away from the centroid of the seat's field farms, and
 *  `nearFarm`, which says whether a node lies within a farm's field radius plus
 *  {@link HOME_FARM_MARGIN_NODES}. Null while the seat has no field farm. */
function homeFarSide(
  world: World,
  farms: ReturnType<typeof fieldFarms>,
  anchor: HalfCellNode,
): { readonly centre: HalfCellNode; readonly nearFarm: (x: number, y: number) => boolean } | null {
  const farm = anchorCentroid(
    world,
    farms.map((f) => f.e),
  );
  if (farm === null) return null;
  const away = { hx: 2 * anchor.hx - farm.hx, hy: 2 * anchor.hy - farm.hy };
  return {
    centre: towardNode(anchor, away, HOME_FAR_SIDE_PUSH_NODES),
    nearFarm: (x, y) =>
      farms.some((f) => nodeManhattan(f.node, { hx: x, hy: y }) <= f.radius + HOME_FARM_MARGIN_NODES),
  };
}

/** How far around a `room` placement the buildings it names land, in Manhattan nodes (authored): the
 *  mill, bakery and well searches grow outward from the farm, and this diamond of 545 nodes holds the
 *  reserved zones of the farm and its chain (443 nodes on the default content) with the gaps between. */
export const CHAIN_ROOM_RADIUS_NODES = 16;

/** How many nodes of free ground a `room` spot lacks per ring of distance it costs (authored): about a
 *  well's reserved zone, so a spot a few rings farther out with room for one more workshop wins. */
export const ROOM_SHORTFALL_NODES_PER_RING = 16;

/** The most rings a `room` spot's shortfall costs (authored): a crowded seat still keeps its farm within
 *  about one chain's radius of the nearest roomy spot rather than across the map. */
export const ROOM_SHORTFALL_MAX_RINGS = 12;

/** How many rings a spot pulled toward a deposit pays for standing within {@link CHAIN_ROOM_RADIUS_NODES}
 *  of a field farm (authored, owner ruling: a mason or potter beside the farm leaves no room for its
 *  chain): a deposit spot a few rings off still beats taking that ground. */
export const FARM_ROOM_RESOURCE_PENALTY_RINGS = 6;

/** The reserved nodes of the type's footprint, the anchor alone for a type with none. */
function reservedNodes(ctx: SystemContext, typeId: number, tribe: number): number {
  return Math.max(1, buildingFootprintOf(ctx.content, typeId, tribe)?.reserved.length ?? 0);
}

/**
 * The cost in rings of a `room` entry's spot: the free ground within {@link CHAIN_ROOM_RADIUS_NODES}
 * (buildable, no obstacle or building zone on it) short of the reserved zones of the building and every
 * one its `room` names, per {@link ROOM_SHORTFALL_NODES_PER_RING}, at most
 * {@link ROOM_SHORTFALL_MAX_RINGS}. Null for an entry with no `room`. Free nodes are summed by row
 * prefixes built on first use, so a spot costs one span per row of the diamond. Read only on accepted
 * spots and within one search, since the placement grid is live.
 */
function roomPenalty(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  type: BuildingType,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): ((x: number, y: number) => number) | null {
  if (entry.room === undefined) return null;
  let need = reservedNodes(ctx, type.typeId, tribe);
  for (const id of entry.room) {
    const named = buildingTypeByContentId(ctx.content, id);
    if (named !== undefined) need += reservedNodes(ctx, named.typeId, tribe);
  }
  const grid = placementBlockerGrid(world, ctx.content, terrain);
  const { width, height } = terrain;
  const rows = new Map<number, Int32Array>();
  const freeRow = (y: number): Int32Array => {
    let prefix = rows.get(y);
    if (prefix !== undefined) return prefix;
    prefix = new Int32Array(width + 1);
    for (let x = 0; x < width; x++) {
      const slot = y * width + x;
      const free =
        terrain.isBuildable(terrain.nodeAt(x, y)) &&
        (grid.obstacle[slot] ?? 0) === 0 &&
        (grid.buildingZone[slot] ?? 0) === 0;
      prefix[x + 1] = (prefix[x] ?? 0) + (free ? 1 : 0);
    }
    rows.set(y, prefix);
    return prefix;
  };
  const radius = CHAIN_ROOM_RADIUS_NODES;
  return (x, y) => {
    let free = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const cy = y + dy;
      if (cy < 0 || cy >= height) continue;
      const span = radius - Math.abs(dy);
      const lo = Math.max(0, x - span);
      const hi = Math.min(width - 1, x + span);
      if (lo > hi) continue;
      const prefix = freeRow(cy);
      free += (prefix[hi + 1] ?? 0) - (prefix[lo] ?? 0);
    }
    const short = need - free;
    return short <= 0
      ? 0
      : Math.min(ROOM_SHORTFALL_MAX_RINGS, Math.ceil(short / ROOM_SHORTFALL_NODES_PER_RING));
  };
}

/** The centre the ring search grows from: the integer mean of the entry's resolved affinity nodes,
 *  clamped back into the seat's {@link BuildReach}, or the anchor itself when nothing resolves. The first
 *  `resource` deposit is the one nearest the anchor and every later one the one nearest that first deposit
 *  (authored): a smithy wants its iron and wood side by side, and the wood nearest the base often lies on
 *  the far side of it from the iron, which drew the mean to the base and the smithy away from both. `within`
 *  keeps the spot in reach of what it serves: the building an `unlessWithin` entry's affinity picked, or
 *  the ship water a `shore` affinity found, on the seat's continent. Null when a `shore` affinity finds
 *  no water, since a spot anywhere else would serve no ship. */
function searchCentre(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  reach: BuildReach,
  type: BuildingType,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  acceptor: SpotAcceptor,
  underFire: EnemyFire,
): { centre: HalfCellNode; within: SpotBound } | null {
  const anchors: HalfCellNode[] = [];
  let firstDeposit: HalfCellNode | null = null;
  let within: SpotBound = null;
  for (const affinity of entry.near ?? []) {
    if (affinity.kind === 'shore') {
      const accept = acceptor.around(underFire, anchor, SHORE_SEARCH_RADIUS_NODES + SHORE_SPOT_SPAN_NODES);
      const shore = shoreTarget(world, ctx, terrain, player, owned, anchor, tribe, accept);
      if (shore === null) return null;
      const { node, home } = shore;
      anchors.push(node);
      within = (x, y) =>
        hexDistanceBetween(node.hx, node.hy, x, y) < SHORE_SPOT_RINGS &&
        terrain.componentOf(terrain.nodeAt(x, y)) === home;
      continue;
    }
    const from = affinity.kind === 'resource' ? (firstDeposit ?? anchor) : anchor;
    const node = affinityNode(world, ctx, terrain, player, owned, anchor, from, type, entry, affinity);
    if (node === null) continue;
    anchors.push(node);
    if (affinity.kind === 'resource') firstDeposit ??= node;
    const serveRadius = entry.unlessWithin?.radius;
    if (
      affinity.kind === 'building' &&
      affinity.id === entry.unlessWithin?.building &&
      serveRadius !== undefined
    )
      within = (x, y) => withinNodeRadius(node.hx, node.hy, x, y, serveRadius);
  }
  if (anchors.length === 0) return { centre: anchor, within };
  let sx = 0;
  let sy = 0;
  for (const a of anchors) {
    sx += a.hx;
    sy += a.hy;
  }
  return {
    centre: reach.clamp({ hx: Math.floor(sx / anchors.length), hy: Math.floor(sy / anchors.length) }),
    within,
  };
}

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
  return {
    contains(x, y) {
      if (within(centres[last], x, y)) return true;
      for (let i = 0; i < centres.length; i++) {
        if (!within(centres[i], x, y)) continue;
        last = i;
        return true;
      }
      return false;
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

/** What a spot's ground must be: anything, sowable under the whole footprint, or with free sowable ground
 *  within {@link GRASS_BESIDE_NODES} on its own land. */
type GroundRule = 'any' | 'on' | 'beside';

/** Every reserved footprint cell must be sowable ground. Approximation: "the farm stands on grass" is
 *  encoded as the reserved zone on `plantable` terrain (the original's `biocanplanton` class); the
 *  surrounding field ring is not pre-checked, since sowing already skips barren nodes. */
function footprintOnGrass(
  ctx: SystemContext,
  terrain: TerrainGraph,
  type: BuildingType,
  tribe: number,
  x: number,
  y: number,
): boolean {
  const footprint = buildingFootprintOf(ctx.content, type.typeId, tribe);
  if (footprint === undefined) return terrain.isPlantable(terrain.nodeAt(x, y));
  for (const c of footprint.reserved) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy) || !terrain.isPlantable(terrain.nodeAt(cx, cy))) return false;
  }
  return true;
}

/**
 * The legal node inside the seat's {@link BuildReach} of least ring radius from {@link searchCentre} plus
 * the pull toward `anchor`, or null to stall the entry. The reach radius and the pull are the seat's
 * archetype's ({@link seatTuning}), `BUILD_SEARCH_MAX_RADIUS_NODES` and `HQ_PULL_DIVISOR_NODES` on the
 * standard one, and an archetype keeping to its own land bounds every search to the base's land
 * component. The ring budget is twice the reach radius, so a centre inside one building's disc reaches every node of that disc. An
 * `unlessWithin` entry's spot must lie within that radius of the building it serves, or a well would go
 * up that serves nothing, and a `shore` entry's close enough to its ship water for the ship yard.
 * A home with no affinity searches from the far side of the base from the seat's field farms and takes a
 * spot near one only when nothing else is left ({@link homeFarSide}); a deposit-pulled spot pays
 * {@link FARM_ROOM_RESOURCE_PENALTY_RINGS} beside a farm. A `room` entry's spot pays for the free ground
 * it lacks around it ({@link roomPenalty}).
 *
 * An affinity pull that finds nothing yields to the same search from `anchor` (authored): a
 * settlement wider than the fan keeps room on its far side that the pulled centre never reaches, and a
 * barracks or a mint anywhere in it beats a list stalled for half an hour. While `reserveGrass`
 * (`grassReserved`) both searches run off the grass first for a building that does not need it, so
 * the grass stays for the list's grass buildings, and take grass only when no other ground is left in
 * reach. When nothing in reach takes an entry with no spot bound, the pulled search runs once more
 * over the wider {@link overflowBuildReachNodes}, on the base's own
 * land component only, since the wider reach can
 * span a strait the builders cannot walk.
 *
 * On a seat with forecast scripted attacks every search first keeps behind its tower line
 * ({@link scriptedFrontLine}, owner ruling: the town's buildings go behind the towers, never in front of
 * them toward the attacks), and only a seat with no room left behind it places beyond.
 */
export function placementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  underFire: EnemyFire,
  reserveGrass: boolean,
): HalfCellNode | null {
  const line = scriptedFrontLine(world, ctx, player, owned);
  const spot = (front: SpotBound) =>
    boundedSpot(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      type,
      tribe,
      entry,
      underFire,
      reserveGrass,
      front,
    );
  if (line === null) return spot(null);
  return spot((x, y) => !line.beyond(x, y)) ?? spot(null);
}

/** {@link placementSpot} with every spot also inside `front`, or anywhere for null. */
function boundedSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  underFire: EnemyFire,
  reserveGrass: boolean,
  front: SpotBound,
): HalfCellNode | null {
  const tuning = seatTuning(world, player);
  const settlement = buildReach(world, owned, anchor, tuning.reachNodes);
  const acceptor = spotAcceptor(world, ctx, terrain, player, type.typeId, tribe);
  const search = searchCentre(
    world,
    ctx,
    terrain,
    player,
    owned,
    anchor,
    settlement,
    type,
    tribe,
    entry,
    acceptor,
    underFire,
  );
  if (search === null) return null;
  const { within } = search;
  let { centre } = search;
  // A home stays off the field farms' ground and leans to the far side of the base from them; a spot near
  // a farm costs the whole ring budget, so it is taken only when no other spot is left in the fan. A spot
  // pulled toward a deposit pays a few rings for the ground beside a farm that its chain will want.
  const fan = 2 * tuning.reachNodes;
  const affinities = entry.near ?? [];
  const amongHomes = type.kind === BUILDING_KIND.home && affinities.length === 0;
  const deposit = affinities.some((a) => a.kind === 'resource');
  const farms = amongHomes || deposit ? fieldFarms(world, ctx, owned) : [];
  const farSide = amongHomes ? homeFarSide(world, farms, anchor) : null;
  if (farSide !== null) centre = settlement.clamp(farSide.centre);
  const nearFarm = farSide?.nearFarm;
  const avoid =
    nearFarm !== undefined
      ? (x: number, y: number) => (nearFarm(x, y) ? fan : 0)
      : deposit && farms.length > 0
        ? (x: number, y: number) =>
            farms.some((f) => nodeManhattan(f.node, { hx: x, hy: y }) <= CHAIN_ROOM_RADIUS_NODES)
              ? FARM_ROOM_RESOURCE_PENALTY_RINGS
              : 0
        : null;
  const room = roomPenalty(world, ctx, terrain, type, tribe, entry);
  const home = baseComponent(world, ctx, terrain, player);
  const onHomeLand = (x: number, y: number) => terrain.componentOf(terrain.nodeAt(x, y)) === home;
  if (tuning.homeLandOnly && home === NO_COMPONENT) return null;
  const land = bothBounds(tuning.homeLandOnly ? onHomeLand : null, front);
  const ground: GroundRule = entry.ground === 'plantable' ? 'on' : 'any';
  const near = (
    reach: BuildReach,
    from: HalfCellNode,
    bound: SpotBound,
    fan: number,
    rule: GroundRule,
    spareGrass = false,
  ) =>
    spotAround(
      ctx,
      terrain,
      reach,
      acceptor,
      anchor,
      tuning.hqPullDivisorNodes,
      avoid,
      from,
      bound,
      land,
      fan,
      type,
      tribe,
      rule,
      underFire,
      spareGrass,
      room,
    );
  // A `plantable` entry stands on the grass where it fits, else beside it.
  const onOrBeside = (search: (rule: GroundRule) => HalfCellNode | null) =>
    search(ground) ?? (ground === 'on' ? search('beside') : null);
  const inReach = (rule: GroundRule, spareGrass: boolean) =>
    near(settlement, centre, within, fan, rule, spareGrass) ??
    (centre.hx === anchor.hx && centre.hy === anchor.hy
      ? null
      : near(settlement, anchor, within, fan, rule, spareGrass));
  const offGrass = reserveGrass && !grassBound(type, entry) ? inReach(ground, true) : null;
  if (offGrass !== null) return offGrass;
  const found = onOrBeside((rule) => inReach(rule, false));
  // A bounded entry's disc already lies in the usual reach, so only an unbounded one overflows.
  if (found !== null || within !== null) return found;
  if (home === NO_COMPONENT) return null;
  const overflowNodes = overflowBuildReachNodes(tuning.reachNodes);
  const overflow = buildReach(world, owned, anchor, overflowNodes);
  return onOrBeside((rule) => near(overflow, centre, onHomeLand, 2 * overflowNodes, rule));
}

function bothBounds(a: SpotBound, b: SpotBound): SpotBound {
  if (a === null) return b;
  if (b === null) return a;
  return (x, y) => a(x, y) && b(x, y);
}

function spotAround(
  ctx: SystemContext,
  terrain: TerrainGraph,
  settlement: BuildReach,
  acceptor: SpotAcceptor,
  anchor: HalfCellNode,
  hqPullDivisorNodes: number,
  avoid: ((x: number, y: number) => number) | null,
  centre: HalfCellNode,
  within: SpotBound,
  land: SpotBound,
  fan: number,
  type: BuildingType,
  tribe: number,
  ground: GroundRule,
  underFire: EnemyFire,
  spareGrass: boolean,
  room: ((x: number, y: number) => number) | null,
): HalfCellNode | null {
  const accept = acceptor.around(underFire, centre, fan, spareGrass);
  const reach = settlement.around(centre, fan);
  const hqPull = (x: number, y: number): number =>
    Math.floor((Math.abs(x - anchor.hx) + Math.abs(y - anchor.hy)) / hqPullDivisorNodes) +
    (avoid === null ? 0 : avoid(x, y));
  return bestRingNode(
    centre.hx,
    centre.hy,
    fan,
    hqPull,
    (x, y) => {
      // The reach first: an affinity-pulled centre puts much of every ring outside it, and a stalled
      // entry re-walks the whole fan on every retry.
      if (!reach.contains(x, y)) return false;
      if (!terrain.inBounds(x, y)) return false; // the bound and the ground test resolve nodes
      if (within !== null && !within(x, y)) return false;
      if (land !== null && !land(x, y)) return false;
      if (ground === 'on' && !footprintOnGrass(ctx, terrain, type, tribe, x, y)) return false;
      // The beside scan walks a diamond, so it runs last, on spots that are legal otherwise.
      return accept(x, y) && (ground !== 'beside' || acceptor.grassBeside(x, y));
    },
    room ?? undefined,
  );
}
