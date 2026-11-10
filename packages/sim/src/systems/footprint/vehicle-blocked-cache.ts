import type { ContentSet } from '@open-northland/data';
import { Position, Vehicle } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { discOffsets, forEachVehicleFootprintNode } from './vehicle-footprint.js';

// The memoized per-world cache of cells standing vehicles cover, which other vehicles may not enter,
// counted per cell so a vehicle's own disc never hides another's cover of the same cell.
// Keyed on the Vehicle store's membership and value generations: a vehicle stands still until a mover
// writes it, and that write goes through `World.mut(e, Vehicle)`, which is what keeps the key exact once
// vehicles move. A value write re-counts only the written vehicles whose disc changed, so a drive's
// writes cost a disc each and a fleet under way never re-walks the vehicles standing still.

/** The disc a vehicle is counted under: its anchor node and its type's `logicSize`. */
interface CountedDisc {
  readonly hx: number;
  readonly hy: number;
  readonly radius: number;
}

interface VehicleBlockedCache {
  membershipGeneration: number;
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Map<NodeId, number>;
  readonly discs: Map<Entity, CountedDisc>;
}

const vehicleBlockedCache = new WeakMap<World, VehicleBlockedCache>();

/** Add `delta` to the count of every cell of `disc` on the map; a cell no disc covers holds no entry. */
function countDisc(
  terrain: TerrainGraph,
  cells: Map<NodeId, number>,
  disc: CountedDisc,
  delta: number,
): void {
  const offsets = discOffsets(disc.radius, disc.hy);
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i] as HalfCellNode;
    const hx = disc.hx + offset.hx;
    const hy = disc.hy + offset.hy;
    if (!terrain.inBounds(hx, hy)) continue;
    const node = terrain.nodeAt(hx, hy);
    const count = (cells.get(node) ?? 0) + delta;
    if (count === 0) cells.delete(node);
    else cells.set(node, count);
  }
}

/** Re-count `e` when the disc it is held under is no longer the one it stands on. */
function recount(world: World, cache: VehicleBlockedCache, e: Entity): void {
  const held = cache.discs.get(e);
  const vehicle = world.tryGet(e, Vehicle);
  const p = world.tryGet(e, Position);
  const type =
    vehicle === undefined || p === undefined
      ? undefined
      : contentIndex(cache.content).vehicles.get(vehicle.vehicleType);
  if (p === undefined || type === undefined) {
    if (held === undefined) return;
    countDisc(cache.terrain, cache.cells, held, -1);
    cache.discs.delete(e);
    return;
  }
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  if (held !== undefined) {
    if (held.hx === hx && held.hy === hy && held.radius === type.logicSize) return;
    countDisc(cache.terrain, cache.cells, held, -1);
  }
  const disc = { hx, hy, radius: type.logicSize };
  countDisc(cache.terrain, cache.cells, disc, 1);
  cache.discs.set(e, disc);
}

/** Every standing vehicle's disc, as how many discs cover each cell. Settlers walk through it, as the
 *  original's map attach sets no blocked bit; only vehicles collide. */
function deriveVehicleBlockedCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): Map<NodeId, number> {
  const cover = new Map<NodeId, number>();
  const count = (hx: number, hy: number): void => {
    const node = terrain.nodeAt(hx, hy);
    cover.set(node, (cover.get(node) ?? 0) + 1);
  };
  for (const e of world.query(Vehicle, Position))
    forEachVehicleFootprintNode(world, content, terrain, e, count);
  return cover;
}

function sameCover(a: ReadonlyMap<NodeId, number>, b: ReadonlyMap<NodeId, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [cell, count] of a) if (b.get(cell) !== count) return false;
  return true;
}

function verifyVehicleBlockedCache(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const cached = vehicleBlockedCache.get(world);
  if (cached === undefined || cached.terrain !== terrain || cached.content !== content) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Vehicle) ||
    cached.valueGeneration !== world.componentValueGeneration(Vehicle)
  ) {
    return [];
  }
  const fresh = deriveVehicleBlockedCells(world, content, terrain);
  if (!sameCover(cached.cells, fresh)) {
    return ['vehicleBlockedCells cache disagrees with a fresh derive - a Vehicle moved outside World.mut'];
  }
  return [];
}

/** The cells standing vehicles cover right now, each with how many vehicles cover it. Derived state,
 *  never hashed; the returned map is the shared cached copy, edited in place as vehicles move: reads
 *  only, within one decision. */
export function vehicleBlockedCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlyMap<NodeId, number> {
  const membershipGeneration = world.componentGeneration(Vehicle);
  const valueGeneration = world.componentValueGeneration(Vehicle);
  const cached = vehicleBlockedCache.get(world);
  if (cached !== undefined && cached.terrain === terrain && cached.content === ctx.content) {
    if (cached.membershipGeneration === membershipGeneration) {
      if (cached.valueGeneration === valueGeneration) return cached.cells;
      const written = world.valueWritesSince(Vehicle, cached.valueGeneration);
      if (written !== null) {
        for (const e of written) recount(world, cached, e);
        cached.valueGeneration = valueGeneration;
        return cached.cells;
      }
    }
  }
  world.journalValueWrites(Vehicle);
  const fresh: VehicleBlockedCache = {
    membershipGeneration,
    valueGeneration,
    content: ctx.content,
    terrain,
    cells: new Map(),
    discs: new Map(),
  };
  for (const e of world.query(Vehicle, Position)) recount(world, fresh, e);
  vehicleBlockedCache.set(world, fresh);
  world.registerCacheVerifier('vehicleBlockedCells', () =>
    verifyVehicleBlockedCache(world, ctx.content, terrain),
  );
  return fresh.cells;
}
