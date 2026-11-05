import { Building, UnderConstruction } from '../../components/index.js';
import { type ContentIndex, contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { NO_COMPONENT } from '../../nav/terrain/index.js';
import { countedTiers } from '../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import { ownedBuildings } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { SHIP_SITE_RINGS, shipWaterWithin } from '../footprint/placement/vehicle-site.js';
import { interactionCell } from '../settlers/targets/index.js';

/** The top-tier joinery, whose crew builds a {@link JoineryRole}'s vehicles. Every joinery of its chain
 *  takes a role by where it stands, so a lower tier by the water is the one the seat lifts to the top. */
export const ROLE_JOINERY_ID = 'work_joinery_03';

/** What a joinery's crew builds once it stands at the top tier. */
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

/** How near its ship water the AI keeps a ship joinery, in hex rings: half the yard search, so the crew
 *  launches near its joinery. Authored: on arabskie_wyspy_wolna_gra_mieszana (seed 7) the original's ten-ring
 *  placement ring left four of five seats' own joineries dry and two seats no free shore spot all game. */
export const SHIP_JOINERY_SHORE_RINGS = SHIP_SITE_RINGS / 2;

/** Whether `joinery` stands by ship water: within {@link SHIP_JOINERY_SHORE_RINGS}, one of the seat's
 *  unfinished `yards` stands or a fresh yard of the ship house fits for a worker at its door
 *  ({@link shipWaterWithin}). The standing yard counts because its own body blocks the water. */
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
  const shore = terrain.componentOf(interactionCell(world, ctx, terrain, joinery));
  if (shore === NO_COMPONENT) return false;
  return shipWaterWithin(
    world,
    ctx,
    terrain,
    house,
    world.get(joinery, Building).tribe,
    player,
    centre,
    shore,
    SHIP_JOINERY_SHORE_RINGS,
    yards,
  );
}

/** The seat's ship joinery ({@link joineryRoles}): a top-tier one by the water, else one of a lower tier of
 *  its chain, or null. */
function shipJoinery(world: World, ctx: SystemContext, player: number): Entity | null {
  const index = contentIndex(ctx.content);
  const top = index.buildingTypeBySlug.get(ROLE_JOINERY_ID);
  const house = smallestShipHouse(index);
  if (top === undefined || house === null) return null;
  const owned = ownedBuildings(world, player);
  const yards = owned.filter(
    (e) => world.get(e, Building).buildingType === house && world.has(e, UnderConstruction),
  );
  const lower: Entity[] = [];
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined || !countedTiers(ctx.content, type, undefined).has(top)) continue;
    if (type.typeId !== top) lower.push(e);
    else if (hasShipWater(world, ctx, player, e, house, yards)) return e;
  }
  return lower.find((e) => hasShipWater(world, ctx, player, e, house, yards)) ?? null;
}

/**
 * One decision's reader of each joinery's role, read off where the seat's joineries stand so no state is
 * kept. While `overSea` holds, the lowest-id top-tier joinery with ship water in its yard rings builds
 * ships, or with none the lowest-id lower tier of its chain by the water, the one the seat lifts to the top;
 * every other one catapults; otherwise all build catapults. Lowest id rather than nearest the water, so a
 * joinery raised later never takes over a crew already on ships. `overSea` and the ship joinery are
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
