import { JobAssignment, LostWay, ownerOf, Person } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvest } from '../../economy/work-flag.js';
import { homeUsedBy } from '../../family/households.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import { type NavigationLimit, navigationLimitFor } from '../../signposts/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { jobCanBuild } from '../atomics/start.js';
import { clearLostWay, markCutOff } from '../lost-way.js';

/** Cadence of the seat-reach check for an idle worker. Approximation: the original raises the lost note
 *  after every five failed walks to work, about this long apart. */
export const CUT_OFF_CHECK_TICKS = 5 * TICKS_PER_SECOND;

/** Whether this tick runs the seat-reach check for every idle worker. */
export function cutOffCheckDue(ctx: SystemContext): boolean {
  return ctx.tick % CUT_OFF_CHECK_TICKS === 0;
}

/** Each seat's building doors, built on the first cadence tick that asks, so a tick with no idle
 *  confined settler pays nothing and one with many pays one pass over the buildings. */
export class SeatDoors {
  private doorsBySeat: Map<number, NodeId[]> | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    private readonly buildings: readonly Entity[],
  ) {}

  /** The door cells of `seat`'s buildings; empty for a seat that owns none. */
  of(seat: number): readonly NodeId[] {
    let doors = this.doorsBySeat;
    if (doors === undefined) {
      doors = new Map<number, NodeId[]>();
      for (const b of this.buildings) {
        const owner = ownerOf(this.world, b);
        const door = owner === undefined ? null : interactionNodeId(this.world, this.ctx, this.terrain, b);
        if (owner === undefined || door === null) continue;
        const list = doors.get(owner);
        if (list === undefined) doors.set(owner, [door]);
        else list.push(door);
      }
      this.doorsBySeat = doors;
    }
    return doors.get(seat) ?? [];
  }
}

function noDoorInReach(seatDoors: readonly NodeId[], limit: NavigationLimit): boolean {
  return seatDoors.length > 0 && !seatDoors.some((door) => limit.allowsNode(door));
}

/** A trade the economy ladder walks somewhere for. A woman or civilist has no work to be cut off from. */
function hasWorkToReach(ctx: SystemContext, jobType: number): boolean {
  return jobCanBuild(ctx.content, jobType) || jobCanHarvest(ctx, jobType) || isCarrierJob(ctx, jobType);
}

/** The door of `e`'s own workplace when `limit` does not reach it, else null. */
export function strandedWorkplaceDoor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  limit: NavigationLimit | null,
): NodeId | null {
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  return workplace === undefined ? null : doorOutOfReach(world, ctx, terrain, workplace, limit);
}

function doorOutOfReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  building: Entity,
  limit: NavigationLimit | null,
): NodeId | null {
  if (limit === null || !world.isAlive(building)) return null;
  const door = interactionNodeId(world, ctx, terrain, building);
  return door === null || limit.allowsNode(door) ? null : door;
}

/** Raise the lost note as soon as a player order posts or houses `e` beyond its reach. Original behavior:
 *  the post binds, the walk there fails and the settler stands lost. The idle tail keeps the mark for a
 *  far workplace until the network reaches it; a far home is only reported, since a settler visits it
 *  between other work. */
export function markIfPostedOutOfReach(world: World, ctx: SystemContext, e: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  const home = homeUsedBy(world, ctx, e);
  if (
    strandedWorkplaceDoor(world, ctx, terrain, e, limit) !== null ||
    (home !== undefined && doorOutOfReach(world, ctx, terrain, home, limit) !== null)
  ) {
    markCutOff(world, ctx, e);
  }
}

/**
 * Mark an idle person lost while its confinement reaches neither its own workplace nor, for a working
 * trade, any door of its seat's buildings, and clear that mark once the way is back in reach.
 * Approximation: the original plans the walk to work anyway and raises the lost note when its guided
 * pathfinder fails; this planner never plans past the gate, so the stranding is read off the gate instead,
 * and so fires for a trade that has no work waiting as well. A seat with no building has no settlement to
 * be cut off from.
 */
export function reconcileCutOff(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  jobType: number,
  limit: NavigationLimit | null,
  doors: SeatDoors,
): void {
  const owner = ownerOf(world, e);
  if (owner === undefined || !world.has(e, Person)) return;
  const marked = world.tryGet(e, LostWay)?.cutOff === true;
  const works = hasWorkToReach(ctx, jobType);
  const stranded =
    strandedWorkplaceDoor(world, ctx, terrain, e, limit) !== null ||
    (works && limit !== null && noDoorInReach(doors.of(owner), limit));
  if (stranded) markCutOff(world, ctx, e);
  else if (marked) clearLostWay(world, e);
}
