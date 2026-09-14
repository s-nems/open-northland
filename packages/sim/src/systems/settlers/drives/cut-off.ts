import { ownerOf, Person } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvest } from '../../economy/work-flag.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import { isCarrierJob } from '../../stores/index.js';
import { jobCanBuild } from '../atomics/start.js';
import type { PlannerContext } from '../planner/context.js';

/** Cadence of the cut-off note while a settler stays cut off. Approximation: the original re-raises the
 *  lost note after every five failed walks to work. */
export const CUT_OFF_ANNOUNCE_TICKS = 5 * TICKS_PER_SECOND;

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

/** A trade the economy ladder walks somewhere for. A woman or civilist has no work to be cut off from. */
function hasWorkToReach(plan: PlannerContext): boolean {
  const { ctx, jobType } = plan;
  return jobCanBuild(ctx.content, jobType) || jobCanHarvest(ctx, jobType) || isCarrierJob(ctx, jobType);
}

/**
 * Announce an idle person of a working trade whose confinement reaches no door of its seat's buildings.
 * Approximation: the original plans the walk to work anyway and raises the lost note when its guided
 * pathfinder fails; this planner never plans past the gate, so the stranding is read off the gate
 * instead, and so fires for a trade that has no work waiting as well. A seat with no building has no
 * settlement to be cut off from.
 */
export function announceIfCutOff(plan: PlannerContext, doors: SeatDoors): void {
  const { world, ctx, entity: e, limit, owner } = plan;
  if (limit === null || ctx.tick % CUT_OFF_ANNOUNCE_TICKS !== 0) return;
  if (owner === undefined || !world.has(e, Person) || !hasWorkToReach(plan)) return;
  const seatDoors = doors.of(owner);
  if (seatDoors.length === 0) return;
  for (const door of seatDoors) if (limit.allowsNode(door)) return;
  ctx.events.emit({ kind: 'settlerCutOff', entity: e });
}
