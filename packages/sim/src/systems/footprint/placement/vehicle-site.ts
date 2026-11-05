import {
  type BuildingFootprint,
  type BuildingType,
  buildingFootprintFor,
  footprintCellDx,
  type VehicleType,
} from '@open-northland/data';
import { Building, Owner, Position, UnderConstruction } from '../../../components/index.js';
import { landscapeEditState } from '../../../components/landscape.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import { type HalfCellNode, hexagonRing, hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../../context.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { ANCHOR_ONLY, houseFootprintOf, translatedCells } from '../geometry.js';
import { interactionCellOf } from '../interaction.js';
import { vehicleClearance } from '../vehicle-clearance.js';
import { vehicleFootprintNodes } from '../vehicle-footprint.js';
import { walkBlockMask } from '../walk-block-mask.js';
import { canPlaceBuilding } from './building.js';

// Where a workshop's worker raises the hidden site of a vehicle house (docs/formats/VEHICLES.md
// "Construction"): an unfinished site of the house within the house's rings of the work centre, else a
// fresh point in those rings whose footprint the vehicle's free-size class admits, house placement
// allows, and no parked vehicle stands on. A ship house (`ignoreContinents`) lands on the water body
// beside the yard with its work point on the worker's shore.

/**
 * Hex rings of the work centre a land vehicle's site is reused from and opened in (`r < 20`, about ten
 * cells). Owner ruling, wider than the original's (placement `r < 10`, reuse `r < 20`): a joinery hemmed
 * in by its own town searches further out for room instead of refusing the cart or catapult.
 */
export const VEHICLE_SITE_RINGS = 20;
/**
 * Hex rings a ship yard's site is reused from and opened in (`r < 40`, about twenty cells). Owner ruling:
 * a joinery on a straight shore fits about 14 moored small ships in them where the original's ten rings
 * fit 2, so launched ships no longer cap its output.
 */
export const SHIP_SITE_RINGS = 40;

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

/**
 * Where a builder on `workerContinent` stands to raise a ship house anchored at `(hx, hy)`: the first cell
 * of the footprint's construction work area, in its canonical order, on that continent and under no walk
 * block. Original behavior: the ship yard search takes a water point only where its work area reaches the
 * worker's continent, and the builder works from that cell (the source lists both ship houses' areas in
 * the canonical order; the free-cell test stands in for the original's per-cell flag). A footprint without
 * a work area, as synthetic content has, keeps its {@link workPoint}.
 */
function shipWorkPoint(
  terrain: TerrainGraph,
  blocks: BlockOverlay,
  footprint: BuildingFootprint | undefined,
  hx: number,
  hy: number,
  workerContinent: number,
): NodeId | null {
  if (workerContinent === NO_COMPONENT) return null;
  let found: NodeId | null = null;
  visitWorkCells(terrain, blocks, footprint, hx, hy, (node, continent) => {
    if (continent !== workerContinent) return false;
    found = node;
    return true;
  });
  return found;
}

/** Calls `visit` with each work-area cell of a ship house at `(hx, hy)` a builder may stand on, and its
 *  continent, in order, until `visit` answers true; {@link shipWorkPoint}'s cells. */
function visitWorkCells(
  terrain: TerrainGraph,
  blocks: BlockOverlay,
  footprint: BuildingFootprint | undefined,
  hx: number,
  hy: number,
  visit: (node: NodeId, continent: number) => boolean,
): void {
  const area = footprint?.workArea;
  if (area === undefined || area.length === 0) {
    const point = workPoint(terrain, footprint, hx, hy);
    const continent = point === null ? NO_COMPONENT : terrain.componentOf(point);
    if (point !== null && continent !== NO_COMPONENT) visit(point, continent);
    return;
  }
  for (const cell of area) {
    const x = hx + footprintCellDx(hy, cell);
    const y = hy + cell.dy;
    if (!terrain.inBounds(x, y)) continue;
    const node = terrain.nodeAt(x, y);
    const continent = terrain.componentOf(node);
    if (continent === NO_COMPONENT || blocks.has(node)) continue;
    if (visit(node, continent)) return;
  }
}

/**
 * The cell a builder on `workerContinent` works the unfinished vehicle site `site` from: a ship site's
 * {@link shipWorkPoint}, else the site's door while it lies on that continent. Null when none does, so the
 * site is out of that builder's walk.
 */
export function vehicleSiteWorkPoint(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  site: Entity,
  workerContinent: number,
): NodeId | null {
  const building = world.tryGet(site, Building);
  const p = world.tryGet(site, Position);
  if (building === undefined || p === undefined) return null;
  if (contentIndex(ctx.content).buildings.get(building.buildingType)?.ignoreContinents === true) {
    const anchor = nodeOfPosition(p.x, p.y);
    const blocks = walkBlockMask(world, ctx, terrain);
    const footprint = houseFootprintOf(ctx.content, building);
    return shipWorkPoint(terrain, blocks, footprint, anchor.hx, anchor.hy, workerContinent);
  }
  const door = interactionCellOf(world, ctx, terrain, site);
  return door !== null && terrain.componentOf(door) === workerContinent ? door : null;
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
 * worker's continent. Unlike a regular house, a vehicle yard refuses occupied ground instead of pushing the vehicle aside.
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
 * Why a ship house's body may not go at `(hx, hy)`, whoever builds it: the body must lie on one water body,
 * its anchor with the free-size class the vehicle needs (the water side of the one clearance field; the
 * anchor alone, as the original reads it and the launched ship's movement does), and no ship parked there.
 * {@link waterObjection} adds the builder's work point.
 */
function waterBodyObjection(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  site: SiteHouse,
  vehicle: VehicleType,
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
  return 'none';
}

/** Why a ship house may not go at `(hx, hy)` for a builder on `workerContinent`: its body's
 *  {@link waterBodyObjection}, else no {@link shipWorkPoint} on that continent. */
function waterObjection(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  site: SiteHouse,
  vehicle: VehicleType,
  workerContinent: number,
  parked: ReadonlySet<NodeId>,
  blocks: BlockOverlay,
  hx: number,
  hy: number,
): Objection {
  const body = waterBodyObjection(world, ctx, terrain, site, vehicle, parked, hx, hy);
  if (body !== 'none') return body;
  return shipWorkPoint(terrain, blocks, site.footprint, hx, hy, workerContinent) === null
    ? 'blocked'
    : 'none';
}

const NO_PARKED: ReadonlySet<NodeId> = new Set();

/**
 * Whether ship water lies in `rings` of `centre` for a worker on `workerContinent`: one of `owner`'s
 * unfinished sites of the ship house `houseType` within the rings qualifies through `reachable`, or a
 * fresh one fits on some water node there, by the rule {@link shipYardProbe} applies. The computer
 * player's joinery ruling reads it, and the placement hint's per-area grid answers the same question for
 * every anchor at once. Approximation: the probe reads no parked ships, so water a standing ship covers still counts
 * until its hull moves or the site it blocks is found occupied in the yard's own search.
 */
export function shipWaterWithin(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  houseType: number,
  tribe: number,
  owner: number | undefined,
  centre: HalfCellNode,
  workerContinent: number,
  rings: number,
  reusable: readonly Entity[],
  reachable: (site: Entity) => boolean = () => true,
): boolean {
  if (reusableVehicleSite(world, reusable, houseType, owner, centre, rings, reachable) !== null) return true;
  if (workerContinent === NO_COMPONENT) return false;
  const fits = shipYardProbe(world, ctx, terrain, houseType, tribe, workerContinent);
  if (fits === null) return false;
  for (let r = 0; r < rings; r++) {
    for (const { point } of hexagonRing(centre, r)) {
      if (!terrain.inBounds(point.hx, point.hy) || !terrain.isWater(terrain.nodeAt(point.hx, point.hy)))
        continue;
      if (fits(point.hx, point.hy)) return true;
    }
  }
  return false;
}

/**
 * The house of the smallest ship `buildingType`'s upgrade chain can produce - a tier's recipes naming a
 * good whose `vehicleHouse` raises on water (`ignoreContinents`) - least `logicSize` first, lowest type
 * id on a tie, the ordering the computer player's content-wide `smallestShipHouse` keeps. Null when no
 * tier builds a ship, so a placement of the type takes no ship-water verdict.
 */
export function chainShipHouse(index: ContentIndex, buildingType: number): number | null {
  let least: { readonly house: number; readonly size: number } | null = null;
  const visited = new Set<number>();
  for (let typeId: number | undefined = buildingType; typeId !== undefined; ) {
    if (visited.has(typeId)) break;
    visited.add(typeId);
    for (const output of index.mergedRecipeByBuilding.get(typeId)?.outputs ?? []) {
      const house = index.goods.get(output.goodType)?.vehicleHouse;
      if (house === undefined) continue;
      const row = index.buildings.get(house);
      if (row === undefined || !row.ignoreContinents) continue;
      const size = row.vehicleType === undefined ? undefined : index.vehicles.get(row.vehicleType)?.logicSize;
      if (
        size === undefined ||
        (least !== null && (size > least.size || (size === least.size && house > least.house)))
      )
        continue;
      least = { house, size };
    }
    typeId = index.buildings.get(typeId)?.upgradeTarget;
  }
  return least?.house ?? null;
}

/** A ship house's site rule for one builder tribe, every builder continent at once. */
export interface ShipYardSites {
  /** Whether a fresh site's body may go at `(hx, hy)`, whoever builds it ({@link waterBodyObjection}). */
  fits(hx: number, hy: number): boolean;
  /** Calls `visit` with each continent a builder could work a site anchored at `(hx, hy)` from: a fresh
   *  one with this tribe's footprint, or a standing `site` with its own. */
  workContinents(hx: number, hy: number, visit: (continent: number) => void, site?: Entity): void;
}

/** {@link ShipYardSites} for `tribe`'s `houseType`, with no ship parked anywhere; null for a type that is not
 *  a ship house. */
export function shipYardSites(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  houseType: number,
  tribe: number,
): ShipYardSites | null {
  const index = contentIndex(ctx.content);
  const house = index.buildings.get(houseType);
  const vehicle = house?.vehicleType === undefined ? undefined : index.vehicles.get(house.vehicleType);
  if (house === undefined || vehicle === undefined || !house.ignoreContinents) return null;
  const site: SiteHouse = { house, tribe, footprint: buildingFootprintFor(house, tribe) };
  const blocks = walkBlockMask(world, ctx, terrain);
  return {
    fits: (hx, hy) => waterBodyObjection(world, ctx, terrain, site, vehicle, NO_PARKED, hx, hy) === 'none',
    workContinents: (hx, hy, visit, standing) => {
      const building = standing === undefined ? undefined : world.tryGet(standing, Building);
      const footprint = building === undefined ? site.footprint : houseFootprintOf(ctx.content, building);
      visitWorkCells(terrain, blocks, footprint, hx, hy, (_node, continent) => {
        visit(continent);
        return false;
      });
    },
  };
}

/**
 * Whether a fresh site of the ship house `houseType` fits anchored at a node for a worker on
 * `workerContinent`, by the water rule {@link findVehicleSite} applies with no ship parked there, so a
 * placement can pick ground whose yard search will succeed. Null for a type that is not a ship house.
 */
export function shipYardProbe(
  world: World,
  ctx: MapContext,
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
  const blocks = walkBlockMask(world, ctx, terrain);
  return (hx, hy) =>
    waterObjection(world, ctx, terrain, site, vehicle, workerContinent, NO_PARKED, blocks, hx, hy) === 'none';
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
  const blocks = walkBlockMask(world, ctx, terrain);
  let occupied = false;
  for (let r = 0, rings = vehicleSiteRings(house); r < rings; r++) {
    for (const { point } of hexagonRing(centre, r)) {
      if (!terrain.inBounds(point.hx, point.hy)) continue;
      const objection = house.ignoreContinents
        ? waterObjection(
            world,
            ctx,
            terrain,
            site,
            vehicle,
            workerContinent,
            parked,
            blocks,
            point.hx,
            point.hy,
          )
        : landObjection(world, ctx, terrain, site, vehicle, workerContinent, parked, point.hx, point.hy);
      if (objection === 'none') return { kind: 'site', node: point };
      if (objection === 'occupied') occupied = true;
    }
  }
  return { kind: occupied ? 'occupied' : 'notFound' };
}
