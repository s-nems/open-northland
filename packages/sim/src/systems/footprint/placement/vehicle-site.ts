import type { BuildingType, VehicleType } from '@open-northland/data';
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
import { hexDisc, vehicleFootprintNodes } from '../vehicle-footprint.js';
import { canPlaceBuilding } from './building.js';

// Where a workshop's worker raises the hidden site of a vehicle house (docs/formats/VEHICLES.md
// "Construction"): an unfinished site of the house within the reuse ring of the work centre, else a
// fresh point in the placement ring whose footprint the vehicle's free-size class admits, house placement
// allows, and no parked vehicle stands on. A ship house (`ignoreContinents`) lands on the water body
// beside the yard with its work point on the worker's shore.

/** Hexagon rings of the work centre an unfinished vehicle site is reused from (`r < 20`). */
export const VEHICLE_SITE_REUSE_RINGS = 20;
/** Hexagon rings of the work centre a new vehicle site is picked in (`r < 10`). */
export const VEHICLE_SITE_PLACEMENT_RINGS = 10;

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
 * The unfinished site of `houseType` owned by `owner` nearest `centre` within the reuse ring, by
 * `(hex distance, id)`; null when none stands there.
 */
export function reusableVehicleSite(
  world: World,
  sites: readonly Entity[],
  houseType: number,
  owner: number | undefined,
  centre: HalfCellNode,
): Entity | null {
  let best: { entity: Entity; distance: number } | null = null;
  for (const e of sites) {
    if (!world.has(e, UnderConstruction)) continue;
    const building = world.tryGet(e, Building);
    const p = world.tryGet(e, Position);
    if (building === undefined || p === undefined || building.buildingType !== houseType) continue;
    if (world.tryGet(e, Owner)?.player !== owner) continue;
    const distance = hexDistance(centre, nodeOfPosition(p.x, p.y));
    if (distance >= VEHICLE_SITE_REUSE_RINGS) continue;
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

/** A node of open water: static ground no unit walks and no land vertex claims. */
function isWater(terrain: TerrainGraph, node: NodeId): boolean {
  return !terrain.isWalkable(node) && terrain.landVertices?.[node] !== true;
}

/**
 * Whether every map point within `size` hexagon steps of `(hx, hy)` is water of `continent`: the
 * water-side twin of the land free-size class (`nav/clearance.ts`), computed on the spot because the
 * clearance field spans land only. Approximation: the original reads one class field for both.
 */
function waterClearanceAdmits(
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  size: number,
  continent: number,
): boolean {
  for (const point of hexDisc({ hx, hy }, size)) {
    if (!terrain.inBounds(point.hx, point.hy)) return false;
    const node = terrain.nodeAt(point.hx, point.hy);
    if (!isWater(terrain, node) || terrain.waterContinents?.[node] !== continent) return false;
  }
  return true;
}

/** The half-cell nodes of `house`'s walk-block body at anchor `(hx, hy)`, or the bare anchor for a
 *  footprint-less type; null when any lies off the map. */
function bodyNodes(terrain: TerrainGraph, house: BuildingType, hx: number, hy: number): NodeId[] | null {
  const cells = house.footprint?.blocked.length ? house.footprint.blocked : ANCHOR_ONLY;
  const nodes = translatedCells(terrain, cells, hx, hy);
  return nodes.length === cells.length ? nodes : null;
}

/** The node the worker stands on to build: the house door, or the anchor for a door-less footprint. */
function workPoint(terrain: TerrainGraph, house: BuildingType, hx: number, hy: number): NodeId | null {
  const door = house.footprint?.door;
  const nodes =
    door === undefined
      ? translatedCells(terrain, ANCHOR_ONLY, hx, hy)
      : translatedCells(terrain, [door], hx, hy);
  return nodes[0] ?? null;
}

type Objection = 'none' | 'blocked' | 'occupied';

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
  house: BuildingType,
  vehicle: VehicleType,
  workerContinent: number,
  parked: ReadonlySet<NodeId>,
  hx: number,
  hy: number,
): Objection {
  const body = bodyNodes(terrain, house, hx, hy);
  if (body === null) return 'blocked';
  for (const node of body) if (parked.has(node)) return 'occupied';
  if (!canPlaceBuilding(world, ctx, terrain, house.typeId, hx, hy)) return 'blocked';
  const point = workPoint(terrain, house, hx, hy);
  if (point === null || terrain.componentOf(point) !== workerContinent) return 'blocked';
  const clearance = vehicleClearance(world, ctx, terrain);
  for (const node of body) {
    if (clearance.classOf(node) < vehicle.logicSize) return 'blocked';
  }
  return 'none';
}

/**
 * Why a ship house may not go at `(hx, hy)`: its body must lie on one water continent, every body node
 * with `logicSize` of water around it, its work point on the worker's shore, and no ship parked there.
 * The shore rule is what "a water continent bordering the worker's continent" reduces to when the work
 * point is a footprint cell (approximation: the original's continent-adjacency test is not read).
 */
function waterObjection(
  world: World,
  terrain: TerrainGraph,
  house: BuildingType,
  vehicle: VehicleType,
  workerContinent: number,
  parked: ReadonlySet<NodeId>,
  hx: number,
  hy: number,
): Objection {
  if (terrain.waterContinents === undefined) return 'blocked';
  const body = bodyNodes(terrain, house, hx, hy);
  if (body === null) return 'blocked';
  for (const node of body) if (parked.has(node)) return 'occupied';
  const anchor = terrain.nodeAt(hx, hy);
  if (!isWater(terrain, anchor)) return 'blocked';
  const continent = terrain.waterContinents[anchor];
  if (continent === undefined) return 'blocked';
  const forbidden = landscapeEditState(world).forbidden;
  for (const node of body) {
    if (forbidden.has(node)) return 'blocked';
    if (!waterClearanceAdmits(terrain, terrain.xOf(node), terrain.yOf(node), vehicle.logicSize, continent)) {
      return 'blocked';
    }
  }
  const point = workPoint(terrain, house, hx, hy);
  if (point === null || terrain.componentOf(point) !== workerContinent) return 'blocked';
  return 'none';
}

/**
 * The first point in the original's ring order (`hexagonRing`, rings 0 to {@link VEHICLE_SITE_PLACEMENT_RINGS}
 * exclusive around `centre`) where a fresh site of `houseType` may go for a worker standing at
 * `workerNode`, else why none may.
 */
export function findVehicleSite(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  houseType: number,
  centre: HalfCellNode,
  workerNode: NodeId,
): VehicleSiteVerdict {
  const index = contentIndex(ctx.content);
  const house = index.buildings.get(houseType);
  const vehicle = house?.vehicleType === undefined ? undefined : index.vehicles.get(house.vehicleType);
  if (house === undefined || vehicle === undefined) return { kind: 'notFound' };
  const workerContinent = terrain.componentOf(workerNode);
  const parked = parkedVehicleNodes(world, ctx, terrain);
  let occupied = false;
  for (let r = 0; r < VEHICLE_SITE_PLACEMENT_RINGS; r++) {
    for (const { point } of hexagonRing(centre, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const objection = house.ignoreContinents
        ? waterObjection(world, terrain, house, vehicle, workerContinent, parked, point.hx, point.hy)
        : landObjection(world, ctx, terrain, house, vehicle, workerContinent, parked, point.hx, point.hy);
      if (objection === 'none') return { kind: 'site', node: point };
      if (objection === 'occupied') occupied = true;
    }
  }
  return { kind: occupied ? 'occupied' : 'notFound' };
}
