import { type ContentSet, type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  Building,
  bioGroundWaived,
  DeliveryFlag,
  Palisade,
  Position,
  peaceHoldsUntilTick,
  ResourceFootprint,
  Signpost,
  Vehicle,
} from '../../../components/index.js';
import { landscapePlacementRevision } from '../../../components/landscape.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import {
  ANCHOR_ONLY,
  buildingFlagBody,
  buildingFootprintOf,
  type HouseKey,
  houseFootprintOf,
} from '../geometry.js';
import { footprintCellsOf } from '../resource-footprint-cells.js';
import { vehicleAnchorRevision } from '../vehicle-anchors.js';
import { hexDisc, vehicleAnchor } from '../vehicle-footprint.js';

// The single definition of what a standing entity blocks, as (cell, channel) pairs. Every placement rule
// in this folder - building (./building.ts) and work flag (./work-flag/) - is stamped from this ONE store
// walk and differs only in which channels it consumes, so a new blocker kind added here reaches every rule
// and no two rules can drift apart.

/**
 * What a standing entity contributes to a cell - merged across entity KIND within each channel, because
 * every rule treats resource and building the same within one:
 *  - **OBSTACLE** - resource WALK bodies, existing building FAMILY bodies, signpost cells, parked
 *    vehicle discs. Rejects a building candidate's RESERVED zone (the "minimum distance from a node/wall"),
 *    less its MOVABLE_BODY part, a wall's body and any work flag. A door outside the family body is
 *    not stamped, so it stays open ground for a flag.
 *  - **EXCLUSION** - resource BUILD zones. Rejects a building candidate's FAMILY BODY, whose walls may not
 *    sit in a resource's build margin; still open ground for a wall and a work flag.
 *  - **BUILDING_ZONE** - existing building RESERVED zones. Rejects a building candidate's RESERVED zone,
 *    so two buildings' reserved rings may not overlap (the zone-vs-zone spacing `canPlaceAnchor` names as
 *    an approximation); still open ground for a wall and a work flag.
 *  - **RESOURCE_ANCHOR** - a resource's own cell, which its walk body need not cover. Blocks a work flag
 *    only.
 *  - **MARKER** - a delivery flag's cell. Blocks another marker, never a building.
 *  - **UPGRADE_RESERVE** - the cells an upgradable building's later levels stand on and its current one
 *    does not: ground its upgrades grow over. OBSTACLE already refuses them; a wall or road line told to
 *    take upgrade ground waives this part of OBSTACLE, and a finishing building spares the road sites on it.
 */
const OBSTACLE = 0;
const EXCLUSION = 1;
const RESOURCE_ANCHOR = 2;
const MARKER = 3;
const BUILDING_ZONE = 4;
/** A palisade's source walk body, present during construction for placement collision only. Rejects
 *  another wall's body and a building's FAMILY BODY; a wall keeps no margin of its own. */
const PALISADE_BODY = 5;
const UPGRADE_RESERVE = 6;
/** The movable part of OBSTACLE, vehicles and signposts, waived by a house, which pushes them aside. */
const MOVABLE_BODY = 7;
type BlockerChannel =
  | typeof OBSTACLE
  | typeof EXCLUSION
  | typeof RESOURCE_ANCHOR
  | typeof MARKER
  | typeof BUILDING_ZONE
  | typeof PALISADE_BODY
  | typeof UPGRADE_RESERVE
  | typeof MOVABLE_BODY;

export {
  type BlockerChannel,
  BUILDING_ZONE,
  EXCLUSION,
  MARKER,
  MOVABLE_BODY,
  OBSTACLE,
  PALISADE_BODY,
  RESOURCE_ANCHOR,
  UPGRADE_RESERVE,
};

/** Opt-in for the {@link MARKER} channel. Only the work-flag rule consumes markers, so a scan that
 *  ignores the channel must not pay for the delivery-flag store walk. */
export type MarkerScan = 'with-markers' | 'without-markers';

export type BlockerVisit = (x: number, y: number, channel: BlockerChannel) => void;

/** One footprinted object's (cell, channel) contributions - a resource node or a chest, the per-entity
 *  slice of {@link eachBlockerCell}, shared with the incremental blocker caches so they cannot drift from
 *  it. A Position-less entity contributes nothing, which a replayed journal entry can reach. */
export function resourceBlockerCells(world: World, e: Entity, visit: BlockerVisit): void {
  const p = world.tryGet(e, Position);
  if (p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const fp = footprintCellsOf(world, e);
  visit(hx, hy, RESOURCE_ANCHOR);
  for (const c of fp.walk) visit(hx + footprintCellDx(hy, c), hy + c.dy, OBSTACLE);
  for (const c of fp.build) visit(hx + footprintCellDx(hy, c), hy + c.dy, EXCLUSION);
}

/** One standing building's (cell, channel) contributions (see {@link resourceBlockerCells}). */
export function buildingBlockerCells(
  world: World,
  content: ContentSet,
  e: Entity,
  visit: BlockerVisit,
): void {
  const b = world.tryGet(e, Building);
  const p = world.tryGet(e, Position);
  if (b === undefined || p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const fp = houseFootprintOf(content, b);
  const body = buildingFlagBody(content, b);
  const zone = fp?.reserved.length ? fp.reserved : ANCHOR_ONLY;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === undefined) continue;
    visit(hx + footprintCellDx(hy, c), hy + c.dy, OBSTACLE);
  }
  for (let i = 0; i < zone.length; i++) {
    const c = zone[i];
    if (c === undefined) continue;
    visit(hx + footprintCellDx(hy, c), hy + c.dy, BUILDING_ZONE);
  }
  const reserveCells = upgradeReserveCells(content, b);
  for (let i = 0; i < reserveCells.length; i++) {
    const c = reserveCells[i];
    if (c === undefined) continue;
    visit(hx + footprintCellDx(hy, c), hy + c.dy, UPGRADE_RESERVE);
  }
}

const upgradeReserves = new WeakMap<ContentSet, Map<string, readonly FootprintCell[]>>();

/** The `blocked` cells of every level above `house` in its chain, less its own, kept per content
 *  and (type, tribe, record). A cell only a lower level stood on is no upgrade's ground. A footprint without walls,
 *  as the approximate catalog's, has no growth to tell from its body. */
function upgradeReserveCells(content: ContentSet, house: HouseKey): readonly FootprintCell[] {
  const { buildingType, tribe, record } = house;
  let byType = upgradeReserves.get(content);
  if (byType === undefined) {
    byType = new Map();
    upgradeReserves.set(content, byType);
  }
  const key = `${buildingType}:${tribe}:${record ?? ''}`;
  const held = byType.get(key);
  if (held !== undefined) return held;
  const standing = houseFootprintOf(content, house)?.blocked ?? [];
  const cells: FootprintCell[] = [];
  if (standing.length > 0) {
    const seen = new Set(standing.map((c) => `${c.dx},${c.dy}`));
    const buildings = contentIndex(content).buildings;
    const climbed = new Set([buildingType]);
    for (let next = buildings.get(buildingType)?.upgradeTarget; next !== undefined && !climbed.has(next); ) {
      climbed.add(next);
      for (const c of buildingFootprintOf(content, next, tribe, record)?.blocked ?? []) {
        const at = `${c.dx},${c.dy}`;
        if (seen.has(at)) continue;
        seen.add(at);
        cells.push(c);
      }
      next = buildings.get(next)?.upgradeTarget;
    }
  }
  byType.set(key, cells);
  return cells;
}

export function palisadeBodyCells(world: World, e: Entity, visit: BlockerVisit): void {
  const wall = world.tryGet(e, Palisade);
  const p = world.tryGet(e, Position);
  if (wall === undefined || p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  for (const c of wall.placementWalk) visit(hx + footprintCellDx(hy, c), hy + c.dy, PALISADE_BODY);
}

/** One signpost's contribution: its anchor is an OBSTACLE no work flag or wall may cover. A building of
 *  any player pushes it aside instead (project rule; the original refuses a rival's post). It never
 *  blocks movement (no walk overlay). */
function signpostBlockerCells(world: World, e: Entity, visit: BlockerVisit): void {
  const p = world.tryGet(e, Position);
  if (p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  visit(hx, hy, OBSTACLE);
  visit(hx, hy, MOVABLE_BODY);
}

/** A vehicle's disc blocks flags, roads and walls. Houses waive its OBSTACLE contribution and
 *  displace it from their body instead (project rule). */
export function vehicleBlockerCells(world: World, content: ContentSet, e: Entity, visit: BlockerVisit): void {
  const vehicle = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (vehicle === undefined || anchor === null) return;
  const type = contentIndex(content).vehicles.get(vehicle.vehicleType);
  if (type === undefined) return;
  for (const { hx, hy } of hexDisc(anchor, type.logicSize)) {
    visit(hx, hy, OBSTACLE);
    visit(hx, hy, MOVABLE_BODY);
  }
}

/** One delivery flag's contribution: its cell on the MARKER channel. */
export function markerBlockerCells(world: World, e: Entity, visit: BlockerVisit): void {
  const p = world.tryGet(e, Position);
  if (p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  visit(hx, hy, MARKER);
}

/** One store of standing blockers: its component and the per-entity contribution above. A blocker kind
 *  added here reaches the full walk and every incremental stamp replaying the same journals. */
export interface BlockerStore {
  readonly component: Component<unknown>;
  readonly cells: (world: World, content: ContentSet, e: Entity, visit: BlockerVisit) => void;
}

/** Named apart because a building's contribution depends on a stored VALUE (`buildingType`), which an
 *  incremental stamp has to guard separately from membership. */
export const BUILDING_STORE: BlockerStore = { component: Building, cells: buildingBlockerCells };

/** Named apart because a vehicle MOVES in place: a drive writes `Vehicle` through `World.mut` with no
 *  membership entry, so an incremental stamp has to guard its anchor separately from membership. */
export const VEHICLE_STORE: BlockerStore = { component: Vehicle, cells: vehicleBlockerCells };

/** The standing blockers, markers excluded: a flag MOVES, so its layer is re-derived rather than
 *  journal-replayed. */
export const BLOCKER_STORES: readonly BlockerStore[] = [
  {
    // Keyed on the footprint rather than `Resource`, so a chest blocks like a node and a re-stamp replays.
    component: ResourceFootprint,
    cells: (world, _content, e, visit) => resourceBlockerCells(world, e, visit),
  },
  BUILDING_STORE,
  { component: Palisade, cells: (world, _content, e, visit) => palisadeBodyCells(world, e, visit) },
  { component: Signpost, cells: (world, _content, e, visit) => signpostBlockerCells(world, e, visit) },
  VEHICLE_STORE,
];

/**
 * Enumerate every (cell, channel) the world's standing resources, buildings, signposts, vehicles and - under
 * `'with-markers'` - delivery flags contribute. Consumers filter by channel; a cell may be visited on more
 * than one channel, and every consumer takes set unions or mask writes with no pick, so store-iteration
 * order cannot change any later answer.
 */
export function eachBlockerCell(
  world: World,
  content: ContentSet,
  visit: BlockerVisit,
  markers: MarkerScan = 'without-markers',
): void {
  for (const store of BLOCKER_STORES) {
    for (const e of world.query(store.component, Position)) store.cells(world, content, e, visit);
  }
  if (markers === 'with-markers') {
    for (const e of world.query(DeliveryFlag, Position)) markerBlockerCells(world, e, visit);
  }
}

/**
 * A per-world version of the placement-blocker inputs: the `Building`, `Palisade`, `ResourceFootprint`,
 * `Signpost` and `Vehicle` membership generations, the scripted landscape placement revision, the
 * `Building` VALUE generation, since the home tier upgrade swaps `buildingType` in place invisibly to
 * membership, and the vehicles' anchor revision, which moves when a vehicle enters a node rather than
 * on every facing, task or seat write. The tier swap moves the UPGRADE_RESERVE cells, which follow each
 * level's own `blocked`, and a map-placed house record whose next tier has no such record moves its
 * OBSTACLE and BUILDING_ZONE cells too. A wall's placement body changes only by a re-add, so its in-place claim
 * and build writes stay out. The `BioGroundRules` waiver changes which ground a well or hive accepts, and
 * a lobby peace's start and end which ground a member seat may build on.
 *
 * Exactness rests on buildings and footprinted objects never MOVING once placed, so a stored entity's
 * cells are fixed, and on a vehicle moving only through a `World.mut(e, Vehicle)` write. Completeness
 * is load-bearing: a memo keyed on this gates a placement, so a missed input is a decision on a stale
 * set. A string, so the monotonic counters compose with no overflow reasoning; never hashed, never a
 * sim decision.
 */
export function placementBlockerVersion(world: World): string {
  return `${world.componentGeneration(Building)}.${world.componentValueGeneration(Building)}.${world.componentGeneration(Palisade)}.${world.componentGeneration(ResourceFootprint)}.${world.componentGeneration(Signpost)}.${world.componentGeneration(Vehicle)}.${vehicleAnchorRevision(world)}.${landscapePlacementRevision(world)}.${bioGroundWaived(world) ? 1 : 0}.${peaceHoldsUntilTick(world) ?? ''}`;
}
