import { type ContentSet, footprintCellDx } from '@open-northland/data';
import {
  Building,
  DeliveryFlag,
  Palisade,
  Position,
  ResourceFootprint,
  Signpost,
} from '../../../components/index.js';
import { landscapePlacementRevision } from '../../../components/landscape.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { ANCHOR_ONLY, buildingFlagBody, buildingFootprintOf } from '../geometry.js';

// The single definition of what a standing entity blocks, as (cell, channel) pairs. Every placement rule
// in this folder - building (./building.ts) and work flag (./work-flag/) - is stamped from this ONE store
// walk and differs only in which channels it consumes, so a new blocker kind added here reaches every rule
// and no two rules can drift apart.

/**
 * What a standing entity contributes to a cell - merged across entity KIND within each channel, because
 * every rule treats resource and building the same within one:
 *  - **OBSTACLE** - resource WALK bodies, existing building FAMILY bodies, signpost cells. Rejects a
 *    building candidate's RESERVED zone (the "minimum distance from a node/wall"), a wall's body and any
 *    work flag. A
 *    building's door is part of its family body, so it stays walkable for routing but takes no flag.
 *  - **EXCLUSION** - resource BUILD zones. Rejects a building candidate's FAMILY BODY, whose walls may not
 *    sit in a resource's build margin; still open ground for a wall and a work flag.
 *  - **BUILDING_ZONE** - existing building RESERVED zones. Rejects a building candidate's RESERVED zone,
 *    so two buildings' reserved rings may not overlap (the zone-vs-zone spacing `canPlaceAnchor` names as
 *    an approximation); still open ground for a wall and a work flag.
 *  - **RESOURCE_ANCHOR** - a resource's own cell, which its walk body need not cover. Blocks a work flag
 *    only.
 *  - **MARKER** - a delivery flag's cell. Blocks another marker, never a building.
 */
const OBSTACLE = 0;
const EXCLUSION = 1;
const RESOURCE_ANCHOR = 2;
const MARKER = 3;
const BUILDING_ZONE = 4;
/** A palisade's source walk body, present during construction for placement collision only. Rejects
 *  another wall's body and a building's FAMILY BODY; a wall keeps no margin of its own. */
const PALISADE_BODY = 5;
type BlockerChannel =
  | typeof OBSTACLE
  | typeof EXCLUSION
  | typeof RESOURCE_ANCHOR
  | typeof MARKER
  | typeof BUILDING_ZONE
  | typeof PALISADE_BODY;

export { type BlockerChannel, BUILDING_ZONE, EXCLUSION, MARKER, OBSTACLE, PALISADE_BODY, RESOURCE_ANCHOR };

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
  const fp = world.get(e, ResourceFootprint);
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
  const fp = buildingFootprintOf(content, b.buildingType);
  const body = buildingFlagBody(content, b.buildingType);
  const zone = fp?.reserved.length ? fp.reserved : ANCHOR_ONLY;
  for (const c of body) visit(hx + footprintCellDx(hy, c), hy + c.dy, OBSTACLE);
  for (const c of zone) visit(hx + footprintCellDx(hy, c), hy + c.dy, BUILDING_ZONE);
}

function palisadeBodyCells(world: World, e: Entity, visit: BlockerVisit): void {
  const wall = world.tryGet(e, Palisade);
  const p = world.tryGet(e, Position);
  if (wall === undefined || p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  for (const c of wall.placementWalk) visit(hx + footprintCellDx(hy, c), hy + c.dy, PALISADE_BODY);
}

/** One signpost's contribution: its anchor is an OBSTACLE - no building's reserved zone and no
 *  work flag may cover it (observed original behaviour). It never blocks movement (no walk overlay). */
function signpostBlockerCells(world: World, e: Entity, visit: BlockerVisit): void {
  const p = world.tryGet(e, Position);
  if (p === undefined) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  visit(hx, hy, OBSTACLE);
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
];

/**
 * Enumerate every (cell, channel) the world's standing resources, buildings, signposts and - under
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
 * A per-world version of the placement-blocker inputs: the `Building`, `ResourceFootprint` and `Signpost`
 * membership generations, the scripted landscape placement revision, plus the `Building` VALUE
 * generation, since the home tier upgrade swaps `buildingType` in place invisibly to membership. That
 * swap cannot change the cells today (`familyBody` and `reserved` are level-chain unions), so the value
 * term only guards a future per-level footprint. It moves when those cells can change rather than every
 * tick.
 *
 * Exactness rests on buildings and footprinted objects never MOVING once placed, so a stored entity's
 * cells are fixed. Completeness is load-bearing: a memo keyed on this gates a placement, so a missed input
 * is a decision on a stale set. A string, so the monotonic counters compose with no overflow reasoning;
 * never hashed, never a sim decision.
 */
export function placementBlockerVersion(world: World): string {
  return `${world.componentGeneration(Building)}.${world.componentValueGeneration(Building)}.${world.componentGeneration(Palisade)}.${world.componentValueGeneration(Palisade)}.${world.componentGeneration(ResourceFootprint)}.${world.componentGeneration(Signpost)}.${landscapePlacementRevision(world)}`;
}
