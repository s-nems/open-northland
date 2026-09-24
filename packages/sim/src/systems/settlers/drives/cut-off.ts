import { LostWay, ownerOf, Person } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvest } from '../../economy/work-flag.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import type { NavigationLimit } from '../../signposts/index.js';
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

/**
 * Mark an idle person of a working trade lost while its confinement reaches no door of its seat's
 * buildings, and clear that mark once a door is back in reach. Approximation: the original plans the walk
 * to work anyway and raises the lost note when its guided pathfinder fails; this planner never plans past
 * the gate, so the stranding is read off the gate instead, and so fires for a trade that has no work
 * waiting as well. A seat with no building has no settlement to be cut off from.
 */
export function reconcileCutOff(
  world: World,
  ctx: SystemContext,
  e: Entity,
  jobType: number,
  limit: NavigationLimit | null,
  doors: SeatDoors,
): void {
  const owner = ownerOf(world, e);
  if (owner === undefined || !world.has(e, Person) || !hasWorkToReach(ctx, jobType)) return;
  if (limit !== null && noDoorInReach(doors.of(owner), limit)) markCutOff(world, ctx, e);
  else if (world.tryGet(e, LostWay)?.cutOff === true) clearLostWay(world, e);
}
