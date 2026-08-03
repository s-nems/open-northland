import { Building, Settler } from '../../../../components/index.js';
import type { Command } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { isFighterJob } from '../../../readviews/index.js';
import { anotherSystemOwns } from '../../../settlers/planner/replan.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { entityNode, manhattan } from '../../../spatial/nodes.js';
import { isBuilt } from '../../shared.js';
import { buildStaffingTally, incrementStaffing, type StaffingTally } from '../../workforce/tally.js';
import { onAnErrand } from '../errand.js';

/**
 * How many archers the seat walls into each tower it raises (user rule). They are SPENT: a posted man
 * leaves the field army for good ({@link import('../census.js').takeCensus} drops him), because a wall that
 * answers on its own is worth more than three more men in a wave - a seat with five soldiers and a standing
 * tower sooner holds its wave back than leaves the tower silent.
 */
export const TOWER_GARRISON_ARCHERS = 3;

/** The postings this decision made, and the men they spend. */
export interface PostOrders {
  readonly commands: readonly Command[];
  /** Men sent to a wall this decision. Their assignment only applies next tick, so the army has to be told
   *  here or it would march them off again in the same batch. */
  readonly claimed: ReadonlySet<Entity>;
}

/**
 * Man the seat's towers: up to {@link TOWER_GARRISON_ARCHERS} of its free archers per standing tower,
 * nearest to the door first, taken only from classes that tower actually offers a slot for.
 *
 * A fighting slot is manned, not trained into (`economy/jobs/openings.ts`), so a seat whose archers are all
 * of the wrong class simply leaves the wall empty - the drafting rung already raises bows and swords in
 * equal number, and posting is not worth reaching into it for.
 */
export function towerPostOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  ready: readonly Entity[],
): PostOrders {
  const commands: Command[] = [];
  const claimed = new Set<Entity>();
  // Resolved on the first tower and not before: most seats own no garrison building for most of a game.
  let staffing: StaffingTally | null = null;
  for (const tower of owned) {
    if (!isBuilt(world, tower)) continue;
    const slots = garrisonSlots(world, ctx, tower);
    if (slots.size === 0) continue;
    staffing ??= buildStaffingTally(world);
    const manned = staffing.get(tower);
    let held = 0;
    for (const jobType of slots.keys()) held += manned?.get(jobType) ?? 0;
    const tribe = world.get(tower, Building).tribe;
    const door = interactionCell(world, ctx, terrain, tower);
    while (held < TOWER_GARRISON_ARCHERS) {
      const pick = nearestFreeArcher(world, terrain, ready, claimed, { slots, staffing, tower, tribe }, door);
      if (pick === null) break;
      claimed.add(pick.archer);
      incrementStaffing(staffing, tower, pick.jobType);
      held++;
      commands.push({
        kind: 'assignWorker',
        entity: pick.archer,
        building: tower,
        jobPriority: [pick.jobType],
      });
    }
  }
  return { commands, claimed };
}

/** The fighting classes a building employs and how many of each (the towers' `logicworker 40/41` bow-soldier
 *  posts), empty for every building staffed by civilians alone. */
function garrisonSlots(world: World, ctx: SystemContext, building: Entity): Map<number, number> {
  const type = contentIndex(ctx.content).buildings.get(world.get(building, Building).buildingType);
  const slots = new Map<number, number>();
  for (const slot of type?.workers ?? []) {
    if (isFighterJob(ctx.content, slot.jobType)) slots.set(slot.jobType, slot.count);
  }
  return slots;
}

/** The wall a candidate is judged against: which classes it employs, how it is staffed right now, and the
 *  tribe it belongs to. */
interface Wall {
  readonly slots: ReadonlyMap<number, number>;
  readonly staffing: StaffingTally;
  readonly tower: Entity;
  readonly tribe: number;
}

/**
 * The free archer closest to `door` this `wall` still has room for, or null. `ready` arrives ascending-id,
 * so the strict `<` keeps the lowest id among equal distances.
 *
 * The gates mirror the ones `assignWorker` applies (same tribe, an understaffed slot of the settler's own
 * class) so a refused command is never issued: an issued-and-refused posting would bench its man from the
 * wave for nothing, decision after decision. The errand guards are the recall's ({@link onAnErrand}) - an
 * assignment cancels the same drill, equip run and action a walk order would.
 */
function nearestFreeArcher(
  world: World,
  terrain: TerrainGraph,
  ready: readonly Entity[],
  claimed: ReadonlySet<Entity>,
  wall: Wall,
  door: NodeId,
): { archer: Entity; jobType: number } | null {
  const reachable = terrain.componentOf(door);
  let best: { archer: Entity; jobType: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of ready) {
    if (claimed.has(e)) continue;
    const settler = world.get(e, Settler);
    const jobType = settler.jobType;
    if (jobType === null || settler.tribe !== wall.tribe) continue;
    const room = wall.slots.get(jobType);
    if (room === undefined || (wall.staffing.get(wall.tower)?.get(jobType) ?? 0) >= room) continue;
    if (anotherSystemOwns(world, e) || onAnErrand(world, e)) continue;
    const at = entityNode(world, terrain, e);
    if (terrain.componentOf(at) !== reachable) continue;
    const distance = manhattan(terrain, at, door);
    if (distance >= bestDistance) continue;
    best = { archer: e, jobType };
    bestDistance = distance;
  }
  return best;
}
