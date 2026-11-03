import { Building, playerPlacementTribes, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { isCarrierJob } from '../../stores/index.js';
import { colonists, colonyOrigin, storeOf } from './founding.js';
import { homeSpare, homeSupply } from './home-supply.js';
import { chainCount, crewInReach, unlocked } from './plan.js';
import { colonyFoodHeld, landHolds, workshopGoods } from './provision.js';
import { colonyBuildings, workshopSpot } from './spot.js';
import { siteRoom } from './survey.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** Owner ruling: a colony may raise the workshops that make weapons and armour, and ship them home. */
const ARMS_WORKSHOP_IDS: ReadonlySet<string> = new Set([
  'work_armory_00',
  'work_smithy_00',
  'work_sewery_00',
]);
/** Free nodes in the site's block a colony needs before it raises one (authored: the room its second home
 *  asks, so arms never crowd out its homes). */
const ARMS_ROOM_NODES = 1000;

function isArmsWorkshop(building: string): boolean {
  return ARMS_WORKSHOP_IDS.has(building);
}

/** Whether each of the colony's arms workshops stands with a craftsman at work: the next waits for it. */
function armsAtWork(env: ColonyEnv, buildings: readonly Entity[]): boolean {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  return buildings.every((e) => {
    const id = index.buildings.get(world.get(e, Building).buildingType)?.id;
    if (id === undefined || !isArmsWorkshop(id)) return true;
    const crafted = assignedWorkers(world, e).some((w) => {
      const job = world.get(w, Settler).jobType;
      return job !== null && !isCarrierJob(ctx, job) && !index.harvestJobs.has(job);
    });
    return isBuilt(world, e) && crafted;
  });
}

/**
 * Plan the next arms workshop, once the last has its craftsman at work, where the colony runs, holds a meal a mouth and has room
 * ({@link ARMS_ROOM_NODES}). Owner ruling: only where the whole chain exists, so each input of one of its
 * recipes is made by a standing colony workshop, lies in the colony's deposits or is home's to spare for its
 * trader; and only while home is short of one of its goods. The tribe must have it unlocked, its trades a
 * man in reach and the land a spot for it. A row in the colony's builds; what it makes goes home with the
 * rest of the colony's surplus (`./stock-policy.ts`).
 */
export function reviewArms(env: ColonyEnv, colony: ColonyView): void {
  const { world, ctx } = env;
  if (colony.phase !== 'running' || colony.builds.some((b) => !b.placed && isArmsWorkshop(b.building)))
    return;
  const buildings = colonyBuildings(env);
  const store = storeOf(env, buildings);
  const origin = colonyOrigin(env, colony, buildings);
  const tribe = playerPlacementTribes(world, env.seat)?.[0];
  if (store === null || !isBuilt(world, store) || origin === null || tribe === undefined) return;
  if (siteRoom(world, colony) < ARMS_ROOM_NODES || !armsAtWork(env, buildings)) return;
  if (colonyFoodHeld(env, buildings) < colonists(env).length) return;
  const index = contentIndex(ctx.content);
  const made = workshopGoods(env, buildings);
  const supply = homeSupply(env);
  const spare = homeSpare(env, supply);
  const sourced = (good: number): boolean =>
    made.has(good) || spare(good) > 0 || landHolds(env, origin, good);
  for (const id of ARMS_WORKSHOP_IDS) {
    const typeId = index.buildingTypeBySlug.get(id);
    const type = typeId === undefined ? undefined : index.buildings.get(typeId);
    if (type === undefined || chainCount(env, buildings, type) > 0) continue;
    const outputs = [...type.produces, ...type.recipes.flatMap((r) => r.outputs.map((o) => o.goodType))];
    if (!outputs.some((good) => !supply.atGlut(good))) continue;
    if (!type.recipes.some((r) => r.inputs.every((input) => sourced(input.goodType)))) continue;
    if (!unlocked(env, type) || !crewInReach(env, type)) continue;
    if (workshopSpot(env, colony.land, type, tribe, origin) === null) continue;
    env.edit().builds.push({ building: id, placed: false });
    return;
  }
}
