import { BUILDING_KIND, type BuildingType, type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../nav/terrain/index.js';
import type { SpotAcceptor } from '../../ai-shared/building-spot.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { anchorCentroid, anchorNodeOf, bestRingNode, towardNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { buildingFootprintOf } from '../../footprint/geometry.js';
import { placementBlockerGrid } from '../../footprint/placement/blocker-grid.js';
import { seatBaseLand } from '../base.js';
import { type SpotBound, searchCentre } from './affinity.js';
import type { BuildOrderEntry } from './entries.js';
import { scriptedFrontLine } from './front.js';
import { grassBound, grassBoundEntry } from './grass-reserve.js';
import { overflowBuildReachNodes } from './limits.js';
import { seatSpotAcceptor } from './plots.js';
import { type BuildReach, buildReach } from './reach.js';
import { seatTuning } from './seat-order.js';
import { baseWalkTest } from './spot-walk.js';

/** A placement that exists to serve something beside it, a workshop an `unlessWithin` entry supplies or
 *  the ships a `shore` workshop launches, a {@link grassBoundEntry} the list can go on without, or one a
 *  seat short of ground lets go (`yieldsRoom`): its line passes it over when no spot is found. */
export function placementPassesOver(
  ctx: SystemContext,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): boolean {
  if (entry.yieldsRoom === true || entry.unlessWithin !== undefined) return true;
  if (entry.near?.some((a) => a.kind === 'shore') ?? false) return true;
  return entry.essential !== true && grassBoundEntry(ctx, entry);
}

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

/** Where a home without affinities, or an `amongHomes` entry, looks (owner ruling): its search centre
 *  pushed {@link HOME_FAR_SIDE_PUSH_NODES} from `anchor` away from the centroid of the seat's field farms,
 *  and `nearFarm`, which says whether a node lies within a farm's field radius plus
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

/** What a spot's ground must be: anything, sowable under the whole footprint, or with free sowable ground
 *  within {@link GRASS_BESIDE_NODES} on its own land. */
type GroundRule = 'any' | 'on' | 'beside';

/** Every reserved footprint cell must be sowable ground. Approximation: "the farm stands on grass" is
 *  encoded as the reserved zone on `plantable` terrain (the original's `biocanplanton` class); the
 *  surrounding field ring is not pre-checked, since sowing already skips barren nodes. */
export function footprintOnGrass(
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
 * A home with no affinity, and an `amongHomes` entry, searches from the far side of the base from the
 * seat's field farms and takes a spot near one only when nothing else is left ({@link homeFarSide}); a
 * deposit-pulled spot pays {@link FARM_ROOM_RESOURCE_PENALTY_RINGS} beside a farm. A `room` entry's spot
 * pays for the free ground it lacks around it ({@link roomPenalty}).
 *
 * An affinity pull that finds nothing yields to the same search from `anchor` (authored): a
 * settlement wider than the fan keeps room on its far side that the pulled centre never reaches, and a
 * barracks or a mint anywhere in it beats a list stalled for half an hour. While `reserveGrass`
 * (`grassReserved`) both searches run off the grass first for a building that does not need it, so
 * the grass stays for the list's grass buildings, and take grass only when no other ground is left in
 * reach. When nothing in reach takes an entry with no spot bound, the pulled search runs once more
 * over the wider {@link overflowBuildReachNodes}, on the base's own
 * land component only, since the wider reach can
 * span a strait the builders cannot walk. Every search takes only a spot a fair walk from the base door
 * ({@link baseWalkTest}), never one across a river that is near only as the crow flies.
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
  const acceptor = seatSpotAcceptor(world, ctx, terrain, player, type.typeId, tribe);
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
  // A home stays off the field farms' ground and leans to the far side of the base from them: each
  // search first runs without the ground near a farm and takes it only when nothing else is left. A spot
  // pulled toward a deposit pays a few rings for the ground beside a farm that its chain will want.
  const fan = 2 * tuning.reachNodes;
  const affinities = entry.near ?? [];
  const amongHomes =
    entry.amongHomes === true || (type.kind === BUILDING_KIND.home && affinities.length === 0);
  const deposit = affinities.some((a) => a.kind === 'resource');
  const farms = amongHomes || deposit ? fieldFarms(world, ctx, owned) : [];
  const farSide = amongHomes ? homeFarSide(world, farms, anchor) : null;
  if (farSide !== null) centre = settlement.clamp(farSide.centre);
  const nearFarm = farSide?.nearFarm;
  const avoid =
    deposit && farms.length > 0
      ? (x: number, y: number) =>
          farms.some((f) => Math.abs(f.node.hx - x) + Math.abs(f.node.hy - y) <= CHAIN_ROOM_RADIUS_NODES)
            ? FARM_ROOM_RESOURCE_PENALTY_RINGS
            : 0
      : null;
  const room = roomPenalty(world, ctx, terrain, type, tribe, entry);
  const home = seatBaseLand(world, ctx, terrain, player);
  const onHomeLand = (x: number, y: number) => terrain.componentOf(terrain.nodeAt(x, y)) === home;
  if (tuning.homeLandOnly && home === NO_COMPONENT) return null;
  const anyLand = bothBounds(tuning.homeLandOnly ? onHomeLand : null, front);
  const offFarms = nearFarm === undefined ? null : bothBounds(anyLand, (x, y) => !nearFarm(x, y));
  const farFirst = (search: (land: SpotBound) => HalfCellNode | null) =>
    offFarms === null ? search(anyLand) : (search(offFarms) ?? search(anyLand));
  const walkable = baseWalkTest(world, ctx, terrain, player);
  const ground: GroundRule = entry.ground === 'plantable' ? 'on' : 'any';
  const near = (
    land: SpotBound,
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
      walkable,
    );
  // A `plantable` entry stands on the grass where it fits, else beside it.
  const onOrBeside = (search: (rule: GroundRule) => HalfCellNode | null) =>
    search(ground) ?? (ground === 'on' ? search('beside') : null);
  const inReach = (land: SpotBound, rule: GroundRule, spareGrass: boolean) =>
    near(land, settlement, centre, within, fan, rule, spareGrass) ??
    (centre.hx === anchor.hx && centre.hy === anchor.hy
      ? null
      : near(land, settlement, anchor, within, fan, rule, spareGrass));
  const offGrass =
    reserveGrass && !grassBound(type, entry) ? farFirst((land) => inReach(land, ground, true)) : null;
  if (offGrass !== null) return offGrass;
  const found = farFirst((land) => onOrBeside((rule) => inReach(land, rule, false)));
  // A bounded entry's disc already lies in the usual reach, so only an unbounded one overflows.
  if (found !== null || within !== null) return found;
  if (home === NO_COMPONENT) return null;
  const overflowNodes = overflowBuildReachNodes(tuning.reachNodes);
  const overflow = buildReach(world, owned, anchor, overflowNodes);
  return farFirst((land) =>
    onOrBeside((rule) => near(land, overflow, centre, onHomeLand, 2 * overflowNodes, rule)),
  );
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
  walkable: SpotBound,
): HalfCellNode | null {
  const accept = acceptor.around(underFire, centre, fan, spareGrass);
  const inReach = settlement.around(centre, fan).boxTest(centre, fan);
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
      if (!inReach(x, y)) return false;
      if (!terrain.inBounds(x, y)) return false; // the bound and the ground test resolve nodes
      if (within !== null && !within(x, y)) return false;
      if (land !== null && !land(x, y)) return false;
      if (ground === 'on' && !footprintOnGrass(ctx, terrain, type, tribe, x, y)) return false;
      // The beside scan walks a diamond and the walk test floods, so they run last, on spots legal otherwise.
      return (
        accept(x, y) &&
        (ground !== 'beside' || acceptor.grassBeside(x, y)) &&
        (walkable === null || walkable(x, y))
      );
    },
    room ?? undefined,
  );
}

export type PlaceCommand = Extract<PlayerCommand, { kind: 'placeBuilding' }>;

/** The seat's order to lay out a site of `type` at `spot`. */
export function siteCommand(
  type: BuildingType,
  spot: HalfCellNode,
  tribe: number,
  player: number,
): PlaceCommand {
  return {
    kind: 'placeBuilding',
    buildingType: type.typeId,
    x: spot.hx,
    y: spot.hy,
    tribe,
    owner: player,
    underConstruction: true,
  };
}
