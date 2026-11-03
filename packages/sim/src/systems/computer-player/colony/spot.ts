import type { BuildingType } from '@open-northland/data';
import { playerPlacementTribes } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { colonyBuildingsOn } from '../../ai-shared/home-roster.js';
import { anchorNodeOf, bestRingNode } from '../../ai-shared/node-geometry.js';
import { routeRegions } from '../../footprint/index.js';
import { placementBlockerGrid } from '../../footprint/placement/blocker-grid.js';
import { VEHICLE_CARGO_SEARCH_RADIUS } from '../../settlers/drives/economy/vehicle-cargo.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { buildReach, footprintOnGrass } from '../build-order/placement.js';
import { seatSpotAcceptor } from '../build-order/plots.js';
import { seatSiege } from '../build-order/siege.js';
import { nearestLiveResource } from '../live-resources.js';
import type { StepGround } from './industry.js';
import { LAND_GOOD_IDS } from './provision.js';
import { colonyStoreType } from './store-tier.js';
import type { ColonyEnv } from './voyage.js';

/** How far from what stands on the colony a building goes, in Manhattan nodes (authored): the walk range,
 *  so a colony with no signpost still reaches its next site. */
const COLONY_REACH_NODES = 50;

/** The buildings the seat holds on this colony, ascending id. */
export function colonyBuildings(env: ColonyEnv): readonly Entity[] {
  return colonyBuildingsOn(env.world, env.ctx, env.seat, env.colony.land);
}

/** How far from the store and what stands a workshop may go (authored): observed on
 *  arabskie_wyspy_wolna_gra_mieszana, a colony's forest left an armory no spot within half this of its store
 *  and many beyond, its footprint being far larger than a home's. */
const WORKSHOP_SPOT_NODES = 100;

/** A wider search than the walk range: its reach of what stands, and the signposts that make it walkable. */
interface FarGround {
  readonly reachNodes: number;
  readonly limit: NavigationLimit | null;
}

/** The spot of a workshop handed over by home, which may lie past the walk range but inside the signposts'
 *  reach from `anchor`. */
export function workshopSpot(
  env: ColonyEnv,
  land: number,
  type: BuildingType,
  tribe: number,
  anchor: HalfCellNode,
): HalfCellNode | null {
  const limit = networkLimitAt(env.world, env.terrain, env.seat, anchor.hx, anchor.hy);
  const far = { reachNodes: WORKSHOP_SPOT_NODES, limit };
  return colonySpot(env, land, type, tribe, anchor, WORKSHOP_SPOT_NODES, 'any', far);
}

/**
 * The spot of `type` nearest `anchor`, a node on the colony's land, within `radius` of it and
 * {@link COLONY_REACH_NODES} of what stands there unless `far` widens it, on `land`, on ground the anchor's walkers reach and out of
 * every enemy shooter's reach; null when none. The home search reads the seat's base throughout, so this
 * is the colony's own over the same parts.
 */
export function colonySpot(
  env: ColonyEnv,
  land: number,
  type: BuildingType,
  tribe: number,
  anchor: HalfCellNode,
  radius: number,
  ground: StepGround = 'any',
  far?: FarGround,
): HalfCellNode | null {
  const { world, ctx, terrain, seat } = env;
  const owned = colonyBuildings(env);
  const reach = buildReach(world, owned, anchor, far?.reachNodes ?? COLONY_REACH_NODES);
  const { underFire } = seatSiege(world, ctx, terrain, seat, owned);
  const acceptor = seatSpotAcceptor(world, ctx, terrain, seat, type.typeId, tribe);
  const regions = routeRegions(world, ctx, terrain);
  const from = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const walled = regions.pocketed(from) ? null : regions;
  const search = (fits: (x: number, y: number) => boolean, spareGrass = false): HalfCellNode | null => {
    const accept = acceptor.around(underFire, anchor, radius, spareGrass);
    return bestRingNode(
      anchor.hx,
      anchor.hy,
      radius,
      () => 0,
      (x, y) =>
        terrain.inBounds(x, y) &&
        terrain.componentOf(terrain.nodeAt(x, y)) === land &&
        reach.contains(x, y) &&
        far?.limit?.allowsNode(terrain.nodeAt(x, y)) !== false &&
        accept(x, y) &&
        fits(x, y) &&
        walled?.unroutable(from, terrain.nodeAt(x, y)) !== true,
    );
  };
  // Owner ruling: the grass stays for a farm and a well where anything else can stand off it.
  if (ground === 'any') return search(() => true, true) ?? search(() => true);
  if (ground === 'grass') return search(() => true);
  // A farm stands on its grass where it fits, else beside it, as the home search has it.
  return (
    search((x, y) => footprintOnGrass(ctx, terrain, type, tribe, x, y)) ??
    search((x, y) => acceptor.grassBeside(x, y))
  );
}

/** How far round a shore its colony's first buildings and gatherers look, in Manhattan nodes (authored: the
 *  store's walk range). */
const SHORE_LOOK_NODES = 50;
/** Sampling step of a shore's open ground, so a look costs a few hundred node reads. */
const SHORE_LOOK_STEP = 3;
/** A shore's score per {@link LAND_GOOD_IDS} good in reach and per live swarm, against one per open node
 *  sampled: a good nobody can reach costs a colony more than a corner of room (authored). */
const SHORE_GOOD_POINTS = 60;
const SHORE_FISH_POINTS = 20;
const SHORE_GRASS_DIVISOR = 8;

/** How a shore serves a colony (owner ruling): open ground, resources in gatherers' reach, grass and fish. */
function shoreScore(env: ColonyEnv, land: number, at: HalfCellNode): number {
  const { world, ctx, terrain } = env;
  const grid = placementBlockerGrid(world, ctx.content, terrain);
  let open = 0;
  let grass = 0;
  for (let dy = -SHORE_LOOK_NODES; dy <= SHORE_LOOK_NODES; dy += SHORE_LOOK_STEP) {
    const span = SHORE_LOOK_NODES - Math.abs(dy);
    for (let dx = -span; dx <= span; dx += SHORE_LOOK_STEP) {
      const x = at.hx + dx;
      const y = at.hy + dy;
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.componentOf(node) !== land || !terrain.isBuildable(node)) continue;
      if ((grid.obstacle[node] ?? 0) === 0) open++;
      if (terrain.isPlantable(node)) grass++;
    }
  }
  const goods = LAND_GOOD_IDS.filter((id) => {
    const good = goodTypeByContentId(ctx.content, id);
    const near = good === undefined ? null : nearestLiveResource(world, good.typeId, at);
    const node = near === null ? null : anchorNodeOf(world, near);
    return node !== null && nodeManhattan(node, at) <= SHORE_LOOK_NODES;
  }).length;
  const fish = fishSwarmsNearNode(world, at.hx, at.hy, SHORE_LOOK_NODES).length;
  return (
    open + Math.floor(grass / SHORE_GRASS_DIVISOR) + SHORE_GOOD_POINTS * goods + SHORE_FISH_POINTS * fish
  );
}

/** The best of `shores` with room for a store in the reach of a hold's hands: they carry cargo into a
 *  warehouse only that near the door. The first best on a tie. Null also for a seat with no tribe or a
 *  content with no store. */
export function shoreWithStore(
  env: ColonyEnv,
  land: number,
  shores: readonly HalfCellNode[],
): HalfCellNode | null {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const type = colonyStoreType(world, ctx, seat);
  if (tribe === undefined || type === undefined) return null;
  let best: HalfCellNode | null = null;
  let bestScore = -1;
  for (const at of shores) {
    if (colonySpot(env, land, type, tribe, at, VEHICLE_CARGO_SEARCH_RADIUS) === null) continue;
    const score = shoreScore(env, land, at);
    if (score <= bestScore) continue;
    best = at;
    bestScore = score;
  }
  return best;
}
