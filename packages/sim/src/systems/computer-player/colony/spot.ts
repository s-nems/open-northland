import type { BuildingType } from '@open-northland/data';
import { playerPlacementTribes } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import { everyBuildingOf, homeBuildings } from '../../ai-shared/home-roster.js';
import { bestRingNode } from '../../ai-shared/node-geometry.js';
import { routeRegions } from '../../footprint/index.js';
import { VEHICLE_CARGO_SEARCH_RADIUS } from '../../settlers/drives/economy/vehicle-cargo.js';
import { buildReach } from '../build-order/placement.js';
import { seatSpotAcceptor } from '../build-order/plots.js';
import { seatSiege } from '../build-order/siege.js';
import { COLONY_STORE_BUILDING_ID } from './survey.js';
import type { ColonyEnv } from './voyage.js';

/** How far from what stands on the colony a building goes, in Manhattan nodes (authored): the walk range,
 *  so a colony with no signpost still reaches its next site. */
const COLONY_REACH_NODES = 50;

/** The buildings `seat` holds on its colony, ascending id. */
export function colonyBuildings(env: ColonyEnv): Entity[] {
  const { world, ctx, seat } = env;
  const home = new Set(homeBuildings(world, ctx, seat));
  return everyBuildingOf(world, seat).filter((e) => !home.has(e));
}

/**
 * The spot of `type` nearest `anchor`, a node on the colony's land, within `radius` of it and
 * {@link COLONY_REACH_NODES} of what stands there, on `land`, on ground the anchor's walkers reach and out of
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
): HalfCellNode | null {
  const { world, ctx, terrain, seat } = env;
  const owned = colonyBuildings(env);
  const reach = buildReach(world, owned, anchor, COLONY_REACH_NODES);
  const { underFire } = seatSiege(world, ctx, terrain, seat, owned);
  const accept = seatSpotAcceptor(world, ctx, terrain, seat, type.typeId, tribe).around(
    underFire,
    anchor,
    radius,
  );
  const regions = routeRegions(world, ctx, terrain);
  const from = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const walled = regions.pocketed(from) ? null : regions;
  return bestRingNode(
    anchor.hx,
    anchor.hy,
    radius,
    () => 0,
    (x, y) =>
      terrain.inBounds(x, y) &&
      terrain.componentOf(terrain.nodeAt(x, y)) === land &&
      reach.contains(x, y) &&
      accept(x, y) &&
      walled?.unroutable(from, terrain.nodeAt(x, y)) !== true,
  );
}

/** The first shore of `shores` with room for a store in the reach of a hold's hands: they carry cargo into a
 *  warehouse only that near the door. Null also for a seat with no tribe or a content with no store. */
export function shoreWithStore(
  env: ColonyEnv,
  land: number,
  shores: readonly HalfCellNode[],
): HalfCellNode | null {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const type = buildingTypeByContentId(ctx.content, COLONY_STORE_BUILDING_ID);
  if (tribe === undefined || type === undefined) return null;
  const fits = (at: HalfCellNode): boolean =>
    colonySpot(env, land, type, tribe, at, VEHICLE_CARGO_SEARCH_RADIUS) !== null;
  return shores.find(fits) ?? null;
}
