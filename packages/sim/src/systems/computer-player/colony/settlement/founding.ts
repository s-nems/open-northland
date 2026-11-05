import { Building, playerPlacementTribes } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { nodeManhattan } from '../../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../../ai-shared/workforce/pool.js';
import { liveWorkFlag } from '../../../economy/work-flag.js';
import { siteCommand } from '../../build-order/ground/placement.js';
import { nearestLiveResource, reachableResourceTest, workableResourceTest } from '../../live-resources.js';
import type { ColonyEnv, ColonyView } from '../env.js';
import { colonists, colonyBuildings, colonyOrigin, storeOf, storeTiers } from '../roster.js';
import { colonySpot, storeSupply, workshopSpot } from '../spot.js';
import { colonyStoreType } from '../store-type.js';
import { unloaded } from '../voyage/voyage.js';
import { colonyFamilies } from './families.js';
import { porterFlagOrders } from './haulers.js';
import { chainStepOf } from './industry.js';
import { COLONY_SPOT_NODES } from './industry-read.js';
import { liftColony, liftStore } from './lifts.js';
import { isOverflowBuilding } from './overflow.js';
import { COLONY_OPEN_SITES, colonyPlan, farStep, openSites, siteFree, stepGround } from './plan.js';
import { type FoundingRead, fillPosts } from './posts.js';
import { storesHeld } from './provision.js';
import { colonyLessons } from './school.js';
import { raiseSignposts } from './scout.js';
import { isColonyTower, towerAnchor } from './towers.js';

/** How far from the first store a deposit gets a second one, in Manhattan nodes (authored: a hold's hands'
 *  reach, past which the carriers' trips outweigh a store's bill). */
const SECOND_STORE_NODES = 40;

/** A colony with no store and none queued, its first one lost, queues one again: no other building of its
 *  plan goes up without one, and no trader calls there. */
function queueLostStore(env: ColonyEnv, colony: ColonyView): void {
  const { world, ctx, seat } = env;
  const type = colonyStoreType(world, ctx, seat);
  const index = contentIndex(ctx.content);
  const tiers = storeTiers(env);
  const queued = colony.builds.some(
    (b) => !b.placed && tiers.has(index.buildingTypeBySlug.get(b.building) ?? -1),
  );
  if (type !== undefined && !queued) env.edit().builds.push({ building: type.id, placed: false });
}

/** The next build the colony lacks, placed while its kind has a site free ({@link siteFree}). The anchor is
 *  a real node on the land, the shore while no store stands, then the store, and a tower's own
 *  ({@link towerAnchor}). */
function nextBuild(env: ColonyEnv, colony: ColonyView, read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const index = contentIndex(ctx.content);
  if (tribe === undefined) return [];
  const open = openSites(env, read.buildings);
  let held: Map<number, number> | undefined;
  const billHeld = (typeId: number): boolean => {
    held ??= storesHeld(env, read.buildings);
    const stored = held;
    const bill = index.constructionBillByBuilding.get(typeId) ?? [];
    return bill.every((line) => (stored.get(line.goodType) ?? 0) >= line.amount);
  };
  const { plan } = read;
  // The first store goes up alone: another site would take the bill the founding ship brought for it, and
  // the trader that brings the rest waits for that store.
  if (colony.phase === 'founding' && read.store !== null && !isBuilt(world, read.store)) return [];
  // With none standing, the store goes up first and past the site budget: every open site waits on its goods.
  const tiers = storeTiers(env);
  const steps =
    read.store === null
      ? plan.filter((b) => tiers.has(index.buildingTypeBySlug.get(b) ?? -1)).slice(0, 1)
      : plan;
  for (const building of steps) {
    const typeId = index.buildingTypeBySlug.get(building);
    const type = typeId === undefined ? undefined : index.buildings.get(typeId);
    if (type === undefined || (read.store !== null && !siteFree(building, open))) continue;
    // An industry's site opens once the colony's stores hold its bill: one waiting on a good locks what it
    // was brought, while the plan's bills still have the trader bring the rest.
    if (chainStepOf(building) !== undefined && !billHeld(type.typeId)) continue;
    const ground = stepGround(building);
    const anchor = isColonyTower(building)
      ? towerAnchor(env, colony, read.origin, read.buildings)
      : read.origin;
    const spot =
      isOverflowBuilding(building) || farStep(building)
        ? workshopSpot(env, colony.land, type, tribe, read.origin)
        : colonySpot(env, colony.land, type, tribe, anchor, COLONY_SPOT_NODES, ground);
    if (spot === null) continue;
    const live = env.edit();
    const row = live.builds.find((b) => b.building === building && !b.placed);
    if (row === undefined) live.builds.push({ building, placed: true });
    else row.placed = true;
    return [siteCommand(type, spot, tribe, seat)];
  }
  return plan.length === 0 && open.other < COLONY_OPEN_SITES ? secondStore(env, colony, read, tribe) : [];
}

/** The next build, or with none to place this decision the next lift (`./lifts.ts`). */
function buildOrLift(env: ColonyEnv, colony: ColonyView, read: FoundingRead): PlayerCommand[] {
  const build = nextBuild(env, colony, read);
  return build.length > 0 ? build : liftColony(env, colony, read);
}

/** A second store by the wood when the nearest stands past {@link SECOND_STORE_NODES} of the first. */
function secondStore(env: ColonyEnv, colony: ColonyView, read: FoundingRead, tribe: number): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  const type = colonyStoreType(world, ctx, seat);
  const wood = goodTypeByContentId(ctx.content, 'wood');
  if (type === undefined || wood === undefined || read.store === null) return [];
  const tiers = storeTiers(env);
  // Counted where they stand, so a lost one is raised again.
  const stores = read.buildings.filter((e) => tiers.has(world.get(e, Building).buildingType));
  if (stores.length > 1) return [];
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    read.origin,
    workableResourceTest(world, ctx, terrain),
  );
  const near = nearestLiveResource(world, wood.typeId, read.origin, reachable);
  const at = near === null ? null : anchorNodeOf(world, near);
  if (at === null || nodeManhattan(at, read.origin) <= SECOND_STORE_NODES) return [];
  // Its builders fetch its bill from the first store, so it stands inside that store's goods search: one
  // past it waits for its bill for good and holds a site's place from every other build.
  const supply = { supply: storeSupply(env, read.origin) };
  const spot = colonySpot(env, colony.land, type, tribe, at, COLONY_SPOT_NODES, 'any', supply);
  if (spot === null) return [];
  env.edit().builds.push({ building: type.id, placed: true });
  return [siteCommand(type, spot, tribe, seat)];
}

/**
 * Founding and running: the colony raises its plan, its first store first, posts its men by {@link POSTS}, marries and
 * houses its people. It runs on, not stopping at `running`, so a post whose man fell is filled by the next
 * free one. `running` starts once the store stands, the hold is empty and a gatherer works.
 */
export function foundColony(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const buildings = colonyBuildings(env);
  const origin = colonyOrigin(env, colony, buildings);
  if (origin === null) return [];
  const store = storeOf(env, buildings);
  if (store === null) queueLostStore(env, colony);
  const read: FoundingRead = { buildings, store, origin, plan: colonyPlan(env, colony, buildings) };
  const people = colonists(env);
  const men = people.filter((e) => isAllocatableMan(world, ctx, e));
  const working = men.some((e) => liveWorkFlag(world, e) !== undefined);
  if (colony.phase === 'founding' && store !== null && isBuilt(world, store) && working) {
    if (colony.ship === null || unloaded(env, colony, colony.ship)) env.edit().phase = 'running';
  }
  const lift = liftStore(env, colony, read);
  const lessons = colonyLessons(env, men);
  return [
    ...(lift.length > 0 ? lift : buildOrLift(env, colony, read)),
    ...lessons.commands,
    ...fillPosts(
      env,
      men.filter((e) => !lessons.pupils.has(e)),
      read,
    ),
    ...porterFlagOrders(env, store),
    ...raiseSignposts(env, men, read),
    ...colonyFamilies(world, ctx, people, buildings),
  ];
}
