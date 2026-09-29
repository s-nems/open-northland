import { Building, UnderConstruction } from '../../components/index.js';
import { type ContentIndex, contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexagonRing } from '../../nav/halfcell.js';
import { NO_COMPONENT } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import {
  reusableVehicleSite,
  shipYardProbe,
  VEHICLE_SITE_PLACEMENT_RINGS,
} from '../footprint/placement/vehicle-site.js';
import { interactionCell } from '../settlers/targets/index.js';
import { anchorNodeOf } from './node-geometry.js';
import { ownedBuildings } from './seat-roster.js';

/** The workplace whose buildings each take a {@link JoineryRole} by where they stand: the top-tier joinery. */
export const ROLE_JOINERY_ID = 'work_joinery_03';

/** What a top-tier joinery's crew builds. */
export type JoineryRole = 'catapult' | 'ship';

/** The house of the content's smallest ship, the one with the least `logicSize` among the vehicles whose
 *  house is raised on water, the lowest type id on a tie; null when the content has none. */
export function smallestShipHouse(index: ContentIndex): number | null {
  let least: { readonly house: number; readonly size: number } | null = null;
  for (const house of index.buildings.values()) {
    if (!house.ignoreContinents || house.vehicleType === undefined) continue;
    const size = index.vehicles.get(house.vehicleType)?.logicSize;
    if (
      size === undefined ||
      (least !== null && (size > least.size || (size === least.size && house.typeId > least.house)))
    )
      continue;
    least = { house: house.typeId, size };
  }
  return least?.house ?? null;
}

/** Whether `joinery`'s crew could launch a ship: one of the seat's unfinished `yards` stands where the
 *  yard drive reuses it, or a fresh yard of the ship house fits within the yard search rings for a worker
 *  at its door ({@link shipYardProbe}). The standing yard counts because its own body blocks the water. */
function hasShipWater(
  world: World,
  ctx: SystemContext,
  player: number,
  joinery: Entity,
  house: number,
  yards: readonly Entity[],
): boolean {
  const terrain = ctx.terrain;
  const centre = anchorNodeOf(world, joinery);
  if (terrain === undefined || centre === null) return false;
  if (reusableVehicleSite(world, yards, house, player, centre) !== null) return true;
  const shore = terrain.componentOf(interactionCell(world, ctx, terrain, joinery));
  if (shore === NO_COMPONENT) return false;
  const fits = shipYardProbe(world, ctx, terrain, house, world.get(joinery, Building).tribe, shore);
  if (fits === null) return false;
  for (let r = 0; r < VEHICLE_SITE_PLACEMENT_RINGS; r++) {
    for (const { point } of hexagonRing(centre, r)) {
      if (!terrain.inBounds(point.hx, point.hy) || !terrain.isWater(terrain.nodeAt(point.hx, point.hy)))
        continue;
      if (fits(point.hx, point.hy)) return true;
    }
  }
  return false;
}

/** The seat's ship joinery ({@link joineryRoles}), or null. */
function shipJoinery(world: World, ctx: SystemContext, player: number): Entity | null {
  const index = contentIndex(ctx.content);
  const type = index.buildingTypeBySlug.get(ROLE_JOINERY_ID);
  const house = smallestShipHouse(index);
  if (type === undefined || house === null) return null;
  const owned = ownedBuildings(world, player);
  const yards = owned.filter(
    (e) => world.get(e, Building).buildingType === house && world.has(e, UnderConstruction),
  );
  for (const e of owned) {
    if (world.get(e, Building).buildingType === type && hasShipWater(world, ctx, player, e, house, yards))
      return e;
  }
  return null;
}

/**
 * One decision's reader of each top-tier joinery's role, read off where the seat's joineries stand so no
 * state is kept. While `overSea` holds, the lowest-id one with ship water in its yard rings builds ships
 * and every other one catapults; otherwise all build catapults. Lowest id rather than nearest the water,
 * so a joinery raised later never takes over a crew already on ships. `overSea` and the ship joinery are
 * looked up once, on the first joinery asked about.
 */
export function joineryRoles(
  world: World,
  ctx: SystemContext,
  player: number,
  overSea: () => boolean,
): (joinery: Entity) => JoineryRole {
  let ship: Entity | null | undefined;
  return (joinery) => {
    if (ship === undefined) ship = overSea() ? shipJoinery(world, ctx, player) : null;
    return joinery === ship ? 'ship' : 'catapult';
  };
}
