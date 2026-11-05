import type { BuildingType } from '@open-northland/data';
import { Building, Stockpile } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween, nodeManhattan } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../nav/terrain/index.js';
import type { SpotAcceptor } from '../../ai-shared/building-spot.js';
import { countedTiers, goodTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { anchorNodeOf, firstRingNode, towardNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { shipYardProbe } from '../../footprint/placement/vehicle-site.js';
import { seatBaseLand } from '../base.js';
import { SHIP_JOINERY_SHORE_RINGS, smallestShipHouse } from '../joinery-role.js';
import { knownResourceTest, nearestLiveResource } from '../live-resources.js';
import { coastsOf, nearestEnemyBuilding, seaRouteOf } from '../sea-route.js';
import { workedDeposit } from '../workforce/collectors/anchor.js';
import type { BuildOrderEntry, PlacementAffinity } from './entries.js';
import { enemiesSurround } from './front.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './limits.js';
import { type BuildReach, buildReach } from './reach.js';

/** Where the spot must land beyond the reach and the acceptor, or null for anywhere. */
export type SpotBound = ((x: number, y: number) => boolean) | null;

/** One affinity other than `shore` ({@link shoreTarget}) resolved to a node, or null when it cannot be. A
 *  `building` affinity takes the seat's lowest-id building of that id or a tier above it, so the pick is
 *  deterministic and an upgraded workshop still anchors; when the entry's `unlessWithin` names the same
 *  id, it takes the first such building with none of the entry's counted kind in reach, the one the
 *  placement exists to serve. A `resource` deposit is the one the seat's gatherers of it work
 *  ({@link workedDeposit}), else the one nearest `from`. */
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
      const resource =
        workedDeposit(world, ctx, player, affinity.good, good.typeId, from, known) ??
        nearestLiveResource(world, good.typeId, from, known);
      return resource === null
        ? stockedStoreNode(world, ctx, owned, good.typeId)
        : anchorNodeOf(world, resource);
    }
    case 'mapCentre':
      return mapCentreNode(terrain);
    case 'front':
      // With enemies all around the seat no side is its front, so the pull stays by the base.
      if (enemiesSurround(world, player, anchor)) return anchor;
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

/**
 * The `shore` target: the water node nearest `anchor` on the lattice's rings where a yard of the content's
 * smallest ship fits with its work point on the seat's home continent ({@link shipYardProbe}), in a body
 * bordering that continent, with a spot `accept` takes inside the seat's reach within
 * {@link SHORE_SPOT_RINGS}. A body that also borders the continent of the rival headquarters over the
 * sea is taken first. The home continent is the sea route's while one exists, else the base's, read the
 * same way. Null when no such water lies within {@link SHORE_SEARCH_RADIUS_NODES}.
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
  const home = route?.home ?? seatBaseLand(world, ctx, terrain, player);
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

/** The centre the ring search grows from: the integer mean of the entry's resolved affinity nodes,
 *  clamped back into the seat's {@link BuildReach}, or the anchor itself when nothing resolves. The first
 *  `resource` deposit is the worked one or the one nearest the anchor, every later one the one nearest it
 *  (authored): a smithy wants its iron and wood side by side, and the wood nearest the base often lies on
 *  the far side of it from the iron, which drew the mean to the base and the smithy away from both. `within`
 *  keeps the spot in reach of what it serves: the building an `unlessWithin` entry's affinity picked, or
 *  the ship water a `shore` affinity found, on the seat's continent. Null when a `shore` affinity finds
 *  no water, since a spot anywhere else would serve no ship. */
export function searchCentre(
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
