import {
  type BuildingFootprint,
  type BuildingType,
  buildingFootprintFor,
  type VehicleType,
} from '@open-northland/data';
import { Building, Owner, Position, UnderConstruction } from '../../../components/index.js';
import { landscapeEditState } from '../../../components/landscape.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexagonRing, hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { ANCHOR_ONLY, translatedCells } from '../geometry.js';
import { vehicleClearance } from '../vehicle-clearance.js';
import { vehicleFootprintNodes } from '../vehicle-footprint.js';
import { canPlaceBuilding } from './building.js';

// Where a workshop's worker raises the hidden site of a vehicle house (docs/formats/VEHICLES.md
// "Construction"): an unfinished site of the house within the house's rings of the work centre, else a
// fresh point in those rings whose footprint the vehicle's free-size class admits, house placement
// allows, and no parked vehicle stands on. A ship house (`ignoreContinents`) lands on the water body
// beside the yard with its work point on the worker's shore.

/**
 * Hex rings of the work centre a land vehicle's site is reused from and opened in (`r < 30`). Owner
 * ruling, wider than the original's (placement `r < 10`, reuse `r < 20`): a joinery hemmed in by its
 * own town searches further out for room instead of refusing the cart or catapult.
 */
export const VEHICLE_SITE_RINGS = 30;
/**
 * Hex rings a ship yard's site is reused from and opened in (`r < 80`). Owner ruling: far wider than a
 * land yard's, so launched ships filling the water beside the joinery do not cap how many it builds.
 */
export const SHIP_SITE_RINGS = 80;

/** The rings a site of `house` is searched in: a ship house's, else a land vehicle's. */
export function vehicleSiteRings(house: { readonly ignoreContinents?: boolean | undefined }): number {
  return house.ignoreContinents === true ? SHIP_SITE_RINGS : VEHICLE_SITE_RINGS;
}

/**
 * The search's answer: a node to put the site on, or why the worker gives up. `occupied` is the
 * original's reason 9, raised only when a parked vehicle was the sole objection at every ring point that
 * otherwise qualified; `notFound` is its reason 8.
 */
export type VehicleSiteVerdict =
  | { readonly kind: 'site'; readonly node: HalfCellNode }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'occupied' };

/**
 * The unfinished site of `houseType` owned by `owner` nearest `centre` within `rings` hex rings that
 * `reachable` admits, by `(hex distance, id)`; null when none stands there.
 */
export function reusableVehicleSite(
  world: World,
  sites: readonly Entity[],
  houseType: number,
  owner: number | undefined,
  centre: HalfCellNode,
  rings: number,
  reachable: (site: Entity) => boolean = () => true,
): Entity | null {
  let best: { entity: Entity; distance: number } | null = null;
  for (const e of sites) {
    if (!world.has(e, UnderConstruction)) continue;
    const building = world.tryGet(e, Building);
    const p = world.tryGet(e, Position);
    if (building === undefined || p === undefined || building.buildingType !== houseType) continue;
    if (world.tryGet(e, Owner)?.player !== owner) continue;
    const distance = hexDistance(centre, nodeOfPosition(p.x, p.y));
    if (distance >= rings) continue;
    if (best !== null && (distance > best.distance || (distance === best.distance && e > best.entity)))
      continue;
    if (!reachable(e)) continue;
    if (best === null || distance < best.distance || (distance === best.distance && e < best.entity)) {
      best = { entity: e, distance };
    }
  }
  return best?.entity ?? null;
}

/** Every node a standing vehicle's disc covers, the "parked vehicle inside" test's set. */
function parkedVehicleNodes(world: World, ctx: SystemContext, terrain: TerrainGraph): ReadonlySet<NodeId> {
  const nodes = new Set<NodeId>();
  for (const e of vehicleIndex(world).all) {
    for (const node of vehicleFootprintNodes(world, ctx.content, terrain, e)) nodes.add(node);
  }
  return nodes;
}

/** The half-cell nodes of a house's walk-block body at anchor `(hx, hy)`, or the bare anchor for a
 *  footprint-less type; null when any lies off the map. */
function bodyNodes(
  terrain: TerrainGraph,
  footprint: BuildingFootprint | undefined,
  hx: number,
  hy: number,
): NodeId[] | null {
  const cells = footprint?.blocked.length ? footprint.blocked : ANCHOR_ONLY;
  const nodes = translatedCells(terrain, cells, hx, hy);
  return nodes.length === cells.length ? nodes : null;
}

/** The node the worker stands on to build: the house door, or the anchor for a door-less footprint. */
function workPoint(
  terrain: TerrainGraph,
  footprint: BuildingFootprint | undefined,
  hx: number,
  hy: number,
): NodeId | null {
  const door = footprint?.door;
  const nodes =
    door === undefined
      ? translatedCells(terrain, ANCHOR_ONLY, hx, hy)
      : translatedCells(terrain, [door], hx, hy);
  return nodes[0] ?? null;
}

type Objection = 'none' | 'blocked' | 'occupied';

/** The house a site is sought for, with the footprint its builder's tribe gives it. */
interface SiteHouse {
  readonly house: BuildingType;
  readonly tribe: number;
  readonly footprint: BuildingFootprint | undefined;
}

/**
 * Why a land house may not go at `(hx, hy)`: a parked vehicle on the body, else the placement rule, the
 * free-size class of every body node against the vehicle's `logicSize`, or the work point off the
 * worker's continent. The parked test comes first because a standing vehicle is also a placement
 * obstacle (`./blockers.ts`), which would otherwise read as no spot rather than an occupied one.
 */
function landObjection(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  site: SiteHouse,
  vehicle: VehicleType,
  workerContinent: number,
  parked: ReadonlySet<NodeId>,
  hx: number,
  hy: number,
): Objection {
  const body = bodyNodes(terrain, site.footprint, hx, hy);
  if (body === null) return 'blocked';
  for (const node of body) if (parked.has(node)) return 'occupied';
  if (!canPlaceBuilding(world, ctx, terrain, site.house.typeId, site.tribe, hx, hy)) return 'blocked';
  const point = workPoint(terrain, site.footprint, hx, hy);
  if (point === null || terrain.componentOf(point) !== workerContinent) return 'blocked';
  const clearance = vehicleClearance(world, ctx, terrain);
  for (const node of body) {
    if (clearance.classOf(node) < vehicle.logicSize) return 'blocked';
  }
  return 'none';
}

/**
 * Why a ship house may not go at `(hx, hy)`: its body must lie on one water body, its anchor with the
 * free-size class the vehicle needs (the water side of the one clearance field; the anchor alone, as the
 * launched ship's movement reads it, since the hull's shoreward rows lie against the land its door
 * stands on), its work point on the worker's shore, and no ship parked there. The shore rule is what
 * "a water continent bordering the worker's continent" reduces to when the work point is a footprint
 * cell (approximation: the original's continent-adjacency test is not read).
 */
function waterObjection(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  site: SiteHouse,
  vehicle: VehicleType,
  workerContinent: number,
  parked: ReadonlySet<NodeId>,
  hx: number,
  hy: number,
): Objection {
  // A land anchor never qualifies, so it is refused before the body is built: most ring points are land.
  const anchor = terrain.nodeAt(hx, hy);
  if (!terrain.isWater(anchor)) return 'blocked';
  const body = bodyNodes(terrain, site.footprint, hx, hy);
  if (body === null) return 'blocked';
  for (const node of body) if (parked.has(node)) return 'occupied';
  const continent = terrain.componentOf(anchor);
  const forbidden = landscapeEditState(world).forbidden;
  if (vehicleClearance(world, ctx, terrain).classOf(anchor) < vehicle.logicSize) return 'blocked';
  for (const node of body) {
    if (forbidden.has(node) || terrain.componentOf(node) !== continent) return 'blocked';
  }
  const point = workPoint(terrain, site.footprint, hx, hy);
  if (point === null || terrain.componentOf(point) !== workerContinent) return 'blocked';
  return 'none';
}

const NO_PARKED: ReadonlySet<NodeId> = new Set();

/**
 * Whether a fresh site of the ship house `houseType` fits anchored at a node for a worker on
 * `workerContinent`, by the water rule {@link findVehicleSite} applies with no ship parked there, so a
 * placement can pick ground whose yard search will succeed. Null for a type that is not a ship house.
 */
export function shipYardProbe(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  houseType: number,
  tribe: number,
  workerContinent: number,
): ((hx: number, hy: number) => boolean) | null {
  const index = contentIndex(ctx.content);
  const house = index.buildings.get(houseType);
  const vehicle = house?.vehicleType === undefined ? undefined : index.vehicles.get(house.vehicleType);
  if (house === undefined || vehicle === undefined || !house.ignoreContinents) return null;
  const site: SiteHouse = { house, tribe, footprint: buildingFootprintFor(house, tribe) };
  return (hx, hy) =>
    waterObjection(world, ctx, terrain, site, vehicle, workerContinent, NO_PARKED, hx, hy) === 'none';
}

/**
 * The first point in the original's ring order (`hexagonRing`, the house's {@link vehicleSiteRings} around
 * `centre`) where a fresh site of `tribe`'s `houseType` may go for a worker standing at `workerNode`, else
 * why none may.
 */
export function findVehicleSite(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  houseType: number,
  tribe: number,
  centre: HalfCellNode,
  workerNode: NodeId,
): VehicleSiteVerdict {
  const index = contentIndex(ctx.content);
  const house = index.buildings.get(houseType);
  const vehicle = house?.vehicleType === undefined ? undefined : index.vehicles.get(house.vehicleType);
  if (house === undefined || vehicle === undefined) return { kind: 'notFound' };
  const site: SiteHouse = { house, tribe, footprint: buildingFootprintFor(house, tribe) };
  const workerContinent = terrain.componentOf(workerNode);
  const parked = parkedVehicleNodes(world, ctx, terrain);
  let occupied = false;
  for (let r = 0, rings = vehicleSiteRings(house); r < rings; r++) {
    for (const { point } of hexagonRing(centre, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const objection = house.ignoreContinents
        ? waterObjection(world, ctx, terrain, site, vehicle, workerContinent, parked, point.hx, point.hy)
        : landObjection(world, ctx, terrain, site, vehicle, workerContinent, parked, point.hx, point.hy);
      if (objection === 'none') return { kind: 'site', node: point };
      if (objection === 'occupied') occupied = true;
    }
  }
  return { kind: occupied ? 'occupied' : 'notFound' };
}
