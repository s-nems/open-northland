import { type BuildingType, footprintCellDx, footprintCellMaxAbsDx } from '@open-northland/data';
import { Building, Resource, Stockpile } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../nav/terrain/index.js';
import { seatPlacementProbe } from '../../conflict/contested-ground.js';
import type { SystemContext } from '../../context.js';
import { ANCHOR_ONLY, buildingFlagBody, buildingFootprintOf } from '../../footprint/geometry.js';
import { shipYardProbe } from '../../footprint/placement/vehicle-site.js';
import { roadSitesByNode } from '../../roads/site-index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { resourcesAtNode } from '../../spatial/resources.js';
import { seatBaseOf } from '../base.js';
import { countedTiers, goodTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { SHIP_JOINERY_SHORE_RINGS, smallestShipHouse } from '../joinery-role.js';
import { nearestLiveResource } from '../live-resources.js';
import type { EnemyFire } from '../military/defence/index.js';
import { anchorNodeOf, bestRingNode, firstRingNode, towardNode } from '../node-geometry.js';
import { coastsOf, nearestEnemyBuilding, seaRouteOf } from '../sea-route.js';
import type { BuildOrderEntry, PlacementAffinity } from './entries.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES, OVERFLOW_BUILD_REACH_NODES } from './entries.js';
import { coversGrass, grassBound, grassScarce } from './grass-reserve.js';

/** One affinity other than `shore` ({@link shoreTarget}) resolved to a node, or null when it cannot be. A
 *  `building` affinity takes the seat's lowest-id building of that id or a tier above it, so the pick is
 *  deterministic and an upgraded workshop still anchors; when the entry's `unlessWithin` names the same
 *  id, it takes the first such building with none of the entry's counted kind in reach, the one the
 *  placement exists to serve. */
function affinityNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
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
      const resource = nearestLiveResource(world, good.typeId, anchor);
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
    const distance = nodeDistance(node, target);
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
export function anchorsOfId(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  id: string,
): Entity[] {
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

/** Lattice Manhattan distance, not the anisotropic world metric the spacing veto measures in. */
function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** Where the spot must land beyond the reach and the acceptor, or null for anywhere. */
type SpotBound = ((x: number, y: number) => boolean) | null;

/** The centre the ring search grows from: the integer mean of the entry's resolved affinity nodes,
 *  clamped back into the seat's {@link BuildReach}, or the anchor itself when nothing resolves. `within`
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
    const node = affinityNode(world, ctx, terrain, player, owned, anchor, type, entry, affinity);
    if (node === null) continue;
    anchors.push(node);
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
      return centres.some((c) => nodeDistance(c, centre) <= span + radius);
    },
    around(centre, span) {
      return reachOver(
        centres.filter((c) => nodeDistance(c, centre) <= span + radius),
        fallback,
        radius,
      );
    },
    clamp(node) {
      let nearest = centres[0] ?? fallback;
      for (const c of centres) if (nodeDistance(node, c) < nodeDistance(node, nearest)) nearest = c;
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

/** Every reserved footprint cell must be sowable ground. Approximation: "the farm stands on grass" is
 *  encoded as the reserved zone on `plantable` terrain (the original's `biocanplanton` class); the
 *  surrounding field ring is not pre-checked, since sowing already skips barren nodes. */
function groundAccepted(
  ctx: SystemContext,
  terrain: TerrainGraph,
  type: BuildingType,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  x: number,
  y: number,
): boolean {
  if (entry.ground === undefined) return true;
  const footprint = buildingFootprintOf(ctx.content, type.typeId, tribe);
  if (footprint === undefined) return terrain.isPlantable(terrain.nodeAt(x, y));
  for (const c of footprint.reserved) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy) || !terrain.isPlantable(terrain.nodeAt(cx, cy))) return false;
  }
  return true;
}

/** The deposits a workshop's gatherers dig, which a seat building never covers (authored). The engine's
 *  blockers already keep a zone off every walk body, so this adds only the walk-free deposits; mushrooms,
 *  herbs, trunks and carcasses stay coverable. */
const DEPOSIT_GOOD_IDS: readonly string[] = ['mud', 'stone', 'iron', 'gold'];

/** How far out from its anchor a building of the type's chain ever has a wall, in Manhattan nodes: what an
 *  enemy shot at the building reaches for. */
function wallSpan(ctx: SystemContext, buildingTypeId: number, tribe: number): number {
  const footprint = buildingFootprintOf(ctx.content, buildingTypeId, tribe);
  let span = 0;
  for (const c of [...(footprint?.familyBody ?? []), ...(footprint?.blocked ?? [])]) {
    span = Math.max(span, footprintCellMaxAbsDx(c) + Math.abs(c.dy));
  }
  return span;
}

/**
 * The seat's placement test for one building type, built once a search: the anchors every building on
 * the map holds, the seat's own placement probe, and the deposit zone. {@link SpotAcceptor.around} narrows
 * it to one search's fan: a node is accepted when the building may anchor there, the anchor is free, and
 * no enemy shooter reaches the site. With `spareGrass` the building's reserved zone must also keep off
 * every grass node ({@link grassScarce}).
 */
export interface SpotAcceptor {
  around(
    underFire: EnemyFire,
    centre: HalfCellNode,
    fan: number,
    spareGrass?: boolean,
  ): (x: number, y: number) => boolean;
}

export function spotAcceptor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  buildingTypeId: number,
  tribe: number,
): SpotAcceptor {
  const span = wallSpan(ctx, buildingTypeId, tribe);
  const occupied = new Set<NodeId>(); // an off-grid anchor can never match a candidate, so it is left out
  for (const e of world.query(Building)) {
    const node = anchorNodeOf(world, e);
    if (node !== null && terrain.inBounds(node.hx, node.hy)) occupied.add(terrain.nodeAt(node.hx, node.hy));
  }
  const probe = seatPlacementProbe(world, ctx.content, terrain, ctx.fog, buildingTypeId, tribe, player);
  const reserved = buildingFootprintOf(ctx.content, buildingTypeId, tribe)?.reserved;
  const zone = reserved !== undefined && reserved.length > 0 ? reserved : ANCHOR_ONLY;
  const deposits = new Set<number>();
  for (const id of DEPOSIT_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good !== undefined) deposits.add(good.typeId);
  }
  const body = buildingFlagBody(ctx.content, buildingTypeId, tribe);
  const roadSites = roadSitesByNode(world, terrain);
  return {
    around(underFire, centre, fan, spareGrass = false) {
      const fire = underFire.around(centre.hx, centre.hy, fan, span);
      return (x, y) => {
        if (!terrain.inBounds(x, y)) return false;
        const node = terrain.nodeAt(x, y);
        if (!terrain.isBuildable(node) || occupied.has(node) || fire.reaches(x, y, span)) return false;
        if (spareGrass && coversGrass(terrain, zone, x, y)) return false;
        return (
          probe.canPlace(x, y) &&
          !coversLiveDeposit(world, deposits, zone, x, y) &&
          !coversRoad(terrain, roadSites, body, x, y)
        );
      };
    },
  };
}

/** Whether the body `cells` anchored at `(x, y)` covers a road or a road site. A seat building never does
 *  (authored): a laid road would break under its walls and a site under them is withdrawn. */
function coversRoad(
  terrain: TerrainGraph,
  roadSites: ReadonlyMap<NodeId, Entity>,
  cells: readonly { dx: number; dy: number }[],
  x: number,
  y: number,
): boolean {
  for (const c of cells) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) continue;
    const node = terrain.nodeAt(cx, cy);
    if (terrain.isRoad(node) || roadSites.has(node)) return true;
  }
  return false;
}

/** Whether the zone `cells` anchored at `(x, y)` covers the node of a `deposits` resource with goods left. */
function coversLiveDeposit(
  world: World,
  deposits: ReadonlySet<number>,
  cells: readonly { dx: number; dy: number }[],
  x: number,
  y: number,
): boolean {
  if (deposits.size === 0) return false;
  for (const c of cells) {
    for (const e of resourcesAtNode(world, x + footprintCellDx(y, c), y + c.dy)) {
      const r = world.get(e, Resource);
      if (r.remaining > 0 && deposits.has(r.goodType)) return true;
    }
  }
  return false;
}

/** How many nodes of Manhattan distance from the base anchor cost a candidate spot one ring of distance
 *  from the {@link searchCentre} (authored): the affinity centre stays the main criterion and the base's
 *  closeness decides between spots about as near to it, so a settlement grows round rather than long. */
export const HQ_PULL_DIVISOR_NODES = 4;

/**
 * The legal node inside the seat's {@link BuildReach} of least ring radius from {@link searchCentre} plus
 * the {@link HQ_PULL_DIVISOR_NODES} pull toward `anchor`, or null to stall the entry. The ring budget is
 * twice the reach radius, so a centre inside one building's disc reaches every node of that disc. An
 * `unlessWithin` entry's spot must lie within that radius of the building it serves, or a well would go
 * up that serves nothing, and a `shore` entry's close enough to its ship water for the ship yard.
 *
 * An affinity pull that finds nothing yields to the same search from `anchor` (authored): a
 * settlement wider than the fan keeps room on its far side that the pulled centre never reaches, and a
 * barracks or a mint anywhere in it beats a list stalled for half an hour. A seat short of grass
 * ({@link grassScarce}) runs both searches off the grass first for a building that does not need it, so
 * the grass stays for the farm, the wells and the hives, and takes grass only when no other ground is
 * left in reach. When nothing in reach takes an entry with no spot bound, the pulled search runs once more
 * over {@link OVERFLOW_BUILD_REACH_NODES}, on the base's own land component only, since the wider reach can
 * span a strait the builders cannot walk.
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
): HalfCellNode | null {
  const settlement = buildReach(world, owned, anchor);
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
  const { centre, within } = search;
  const near = (reach: BuildReach, from: HalfCellNode, bound: SpotBound, fan: number, spareGrass = false) =>
    spotAround(
      ctx,
      terrain,
      reach,
      acceptor,
      anchor,
      from,
      bound,
      fan,
      type,
      tribe,
      entry,
      underFire,
      spareGrass,
    );
  const fan = 2 * BUILD_SEARCH_MAX_RADIUS_NODES;
  const inReach = (spareGrass: boolean) =>
    near(settlement, centre, within, fan, spareGrass) ??
    (centre.hx === anchor.hx && centre.hy === anchor.hy
      ? null
      : near(settlement, anchor, within, fan, spareGrass));
  const offGrass = !grassBound(type, entry) && grassScarce(terrain, anchor) ? inReach(true) : null;
  if (offGrass !== null) return offGrass;
  const found = inReach(false);
  // A bounded entry's disc already lies in the usual reach, so only an unbounded one overflows.
  if (found !== null || within !== null) return found;
  const home = baseComponent(world, ctx, terrain, player);
  if (home === NO_COMPONENT) return null;
  const onHomeLand = (x: number, y: number) => terrain.componentOf(terrain.nodeAt(x, y)) === home;
  const overflow = buildReach(world, owned, anchor, OVERFLOW_BUILD_REACH_NODES);
  return near(overflow, centre, onHomeLand, 2 * OVERFLOW_BUILD_REACH_NODES);
}

function spotAround(
  ctx: SystemContext,
  terrain: TerrainGraph,
  settlement: BuildReach,
  acceptor: SpotAcceptor,
  anchor: HalfCellNode,
  centre: HalfCellNode,
  within: SpotBound,
  fan: number,
  type: BuildingType,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  underFire: EnemyFire,
  spareGrass: boolean,
): HalfCellNode | null {
  const accept = acceptor.around(underFire, centre, fan, spareGrass);
  const reach = settlement.around(centre, fan);
  const hqPull = (x: number, y: number): number =>
    Math.floor((Math.abs(x - anchor.hx) + Math.abs(y - anchor.hy)) / HQ_PULL_DIVISOR_NODES);
  return bestRingNode(centre.hx, centre.hy, fan, hqPull, (x, y) => {
    // The reach first: an affinity-pulled centre puts much of every ring outside it, and a stalled
    // entry re-walks the whole fan on every retry.
    if (!reach.contains(x, y)) return false;
    if (!terrain.inBounds(x, y)) return false; // the bound and groundAccepted resolve nodes
    if (within !== null && !within(x, y)) return false;
    if (!groundAccepted(ctx, terrain, type, tribe, entry, x, y)) return false;
    return accept(x, y);
  });
}
