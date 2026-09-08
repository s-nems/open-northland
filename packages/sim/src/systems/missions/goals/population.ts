import {
  Building,
  JobAssignment,
  MissionObjectId,
  ownerOf,
  Person,
  Residence,
  Settler,
} from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { isMinor } from '../../family/households.js';
import { isSoldierJob } from '../../readviews/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { missionHumans } from '../targets.js';

/** The object id a counting goal writes on nothing: the corpus's own "leave these alone" value. */
const UNTAGGED_MATCH_ID = 12345;

/** Holds once the player fields `amount` humans of the job, and stamps the goal's object id on every
 *  one it counted, so a later line can address exactly the group that satisfied it. */
export function buildHumansHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'BuildHumans' }>,
): boolean {
  const { world } = pass;
  const matches = playerHumans(world, op.player, (e) => world.get(e, Settler).jobType === op.job);
  tagMatches(world, matches, op.humanId);
  return matches.length >= op.amount;
}

/** Holds once the player owns `amount` finished houses of the type, tagging them like
 *  {@link buildHumansHolds}. */
export function buildHousesHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'BuildHouses' }>,
): boolean {
  const { world } = pass;
  const matches: Entity[] = [];
  for (const e of world.query(Building)) {
    const building = world.get(e, Building);
    if (building.buildingType !== op.houseType || building.built !== ONE) continue;
    if (ownerOf(world, e) === op.player) matches.push(e);
  }
  tagMatches(world, matches, op.objectId);
  return matches.length >= op.amount;
}

/** Every human of the player, babies and children included. */
export function populationHolds(world: World, player: number, amount: number): boolean {
  return countPlayerHumans(world, player, () => true) >= amount;
}

export function soldierCountHolds(pass: MissionPass, player: number, amount: number): boolean {
  const { world } = pass;
  const soldiers = countPlayerHumans(world, player, (e) =>
    isSoldierJob(pass.ctx.content, world.get(e, Settler).jobType),
  );
  return soldiers >= amount;
}

/** Adults of the player living in a finished home. */
export function humansWithHomeHolds(world: World, player: number, amount: number): boolean {
  const housed = countPlayerHumans(world, player, (e) => {
    if (isMinor(world, e)) return false;
    const home = world.tryGet(e, Residence)?.home;
    return home !== undefined && world.tryGet(home, Building)?.built === ONE;
  });
  return housed >= amount;
}

/** Humans of the player in the job that hold a post in a workplace. */
export function attachedToWorkHouseHolds(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'HumanAttachedToWorkHouse' }>,
): boolean {
  const posted = countPlayerHumans(
    world,
    op.player,
    (e) => world.get(e, Settler).jobType === op.job && world.has(e, JobAssignment),
  );
  return posted >= op.amount;
}

/** Whether any human stamped with the id works the job. */
export function humanJobHolds(world: World, id: number, job: number): boolean {
  return missionHumans(world, id).some((e) => world.get(e, Settler).jobType === job);
}

/** A count needs no order and no array: these goals run over the whole population every pass. */
function countPlayerHumans(world: World, player: number, keep: (e: Entity) => boolean): number {
  let count = 0;
  for (const e of world.query(Person, Settler)) {
    if (ownerOf(world, e) === player && keep(e)) count++;
  }
  return count;
}

function playerHumans(world: World, player: number, keep: (e: Entity) => boolean): Entity[] {
  const out: Entity[] = [];
  for (const e of world.query(Person, Settler)) {
    if (ownerOf(world, e) === player && keep(e)) out.push(e);
  }
  return out;
}

/**
 * Number the matches, ascending by entity id whatever order the scan found them in, since stamping
 * changes the store. An id already held is left alone: these goals re-run every pass over a set that
 * rarely changes, and a re-add would rebuild the object index and re-clone every match each time.
 */
function tagMatches(world: World, matches: Entity[], id: number): void {
  if (id === UNTAGGED_MATCH_ID || id === 0) return;
  matches.sort((a, b) => a - b);
  for (const e of matches) {
    if (world.tryGet(e, MissionObjectId)?.id !== id) world.add(e, MissionObjectId, { id });
  }
}
