import {
  Building,
  Position,
  playerPlacementTribes,
  Rider,
  Settler,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../nav/halfcell.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { everySettlerOf, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { isScoutJob } from '../../readviews/index.js';
import { nearestLiveResource, reachableResourceTest, workableResourceTest } from '../live-resources.js';
import { scoutBusy } from '../scout/index.js';
import { corridorSamples, signpostTargetAround } from '../scout/signpost-coverage.js';
import { colonyFamilies } from './people.js';
import { COLONY_OPEN_SITES, COLONY_SPOT_NODES, colonyPlan, stepGround } from './plan.js';
import { type FoundingRead, fillPosts } from './posts.js';
import { LAND_GOOD_IDS } from './provision.js';
import { colonyBuildings, colonySpot } from './spot.js';
import { COLONY_STORE_BUILDING_ID } from './survey.js';
import { type ColonyEnv, type ColonyView, unloaded } from './voyage.js';

/** What a colony raises first (owner ruling): its warehouse near the shore. The rest it raises as it needs
 *  ({@link colonyPlan}). */
export const COLONY_BUILDS: readonly string[] = [COLONY_STORE_BUILDING_ID];
/** How far from the first store a deposit gets a second one, in Manhattan nodes (authored: a hold's hands'
 *  reach, past which the carriers' trips outweigh a store's bill). */
const SECOND_STORE_NODES = 40;
/** The people standing on the colony: everyone of the seat out of the home view but those aboard. */
export function colonists(env: ColonyEnv): Entity[] {
  const { world, ctx, seat } = env;
  const home = new Set(homeSettlers(world, ctx, seat));
  return everySettlerOf(world, seat).filter(
    (e) => !home.has(e) && !world.has(e, Rider) && world.has(e, Position),
  );
}

/** The colony's first store, standing or a site. */
export function storeOf(env: ColonyEnv, buildings: readonly Entity[]): Entity | null {
  const { world, ctx } = env;
  const store = contentIndex(ctx.content).buildingTypeBySlug.get(COLONY_STORE_BUILDING_ID);
  return buildings.find((e) => world.get(e, Building).buildingType === store) ?? null;
}

/** A real node on the colony's land its work starts from: its store once placed, else the shore. */
export function colonyOrigin(
  env: ColonyEnv,
  colony: ColonyView,
  buildings: readonly Entity[],
): HalfCellNode | null {
  const store = storeOf(env, buildings);
  const at = store === null ? null : anchorNodeOf(env.world, store);
  return at ?? (colony.shore === null ? null : { hx: colony.shore.hx, hy: colony.shore.hy });
}

function placementOf(type: number, spot: HalfCellNode, tribe: number, seat: number): PlayerCommand {
  return {
    kind: 'placeBuilding',
    buildingType: type,
    x: spot.hx,
    y: spot.hy,
    tribe,
    owner: seat,
    underConstruction: true,
  };
}

/** The next build the colony lacks, placed once fewer than {@link COLONY_OPEN_SITES} sites stand open:
 *  the anchor is a real node on the land, the shore while no store stands, then the store. */
function nextBuild(env: ColonyEnv, colony: ColonyView, read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const index = contentIndex(ctx.content);
  if (tribe === undefined) return [];
  const open = read.buildings.filter((e) => world.has(e, UnderConstruction)).length;
  if (open >= COLONY_OPEN_SITES) return [];
  const plan = colonyPlan(env, colony, read.buildings);
  for (const building of read.store === null ? plan.slice(0, 1) : plan) {
    const typeId = index.buildingTypeBySlug.get(building);
    const type = typeId === undefined ? undefined : index.buildings.get(typeId);
    if (type === undefined) continue;
    const ground = stepGround(building);
    const spot = colonySpot(env, colony.land, type, tribe, read.origin, COLONY_SPOT_NODES, ground);
    if (spot === null) continue;
    const live = env.edit();
    const row = live.builds.find((b) => b.building === building && !b.placed);
    if (row === undefined) live.builds.push({ building, placed: true });
    else row.placed = true;
    return [placementOf(type.typeId, spot, tribe, seat)];
  }
  return plan.length === 0 ? secondStore(env, colony, read, tribe) : [];
}

/** A second store by the wood when the nearest stands past {@link SECOND_STORE_NODES} of the first. */
function secondStore(env: ColonyEnv, colony: ColonyView, read: FoundingRead, tribe: number): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  const index = contentIndex(ctx.content);
  const typeId = index.buildingTypeBySlug.get(COLONY_STORE_BUILDING_ID);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  const wood = goodTypeByContentId(ctx.content, 'wood');
  if (type === undefined || wood === undefined || read.store === null) return [];
  if (colony.builds.filter((b) => b.building === COLONY_STORE_BUILDING_ID).length > 1) return [];
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
  const spot = colonySpot(env, colony.land, type, tribe, at, COLONY_SPOT_NODES);
  if (spot === null) return [];
  env.edit().builds.push({ building: COLONY_STORE_BUILDING_ID, placed: true });
  return [placementOf(type.typeId, spot, tribe, seat)];
}

/** The nearest deposit of each good the land holds: a flag stands only inside the signposts, so a deposit
 *  past the store's walk range stays out of work until the lattice reaches it. */
function depositsOf(env: ColonyEnv, origin: HalfCellNode): HalfCellNode[] {
  const { world, ctx, terrain } = env;
  const workable = workableResourceTest(world, ctx, terrain);
  const reachable = reachableResourceTest(world, ctx, terrain, origin, workable);
  return LAND_GOOD_IDS.flatMap((id) => {
    const good = goodTypeByContentId(ctx.content, id);
    const near = good === undefined ? null : nearestLiveResource(world, good.typeId, origin, reachable);
    return near === null ? [] : (anchorNodeOf(world, near) ?? []);
  });
}

/** The colony's one scout carries its lattice round what stands there and out to its land's deposits. */
function raiseSignposts(env: ColonyEnv, men: readonly Entity[], read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const scout = men.find((e) => isScoutJob(ctx.content, world.get(e, Settler).jobType));
  if (scout === undefined || read.store === null || scoutBusy(world, ctx, scout)) return [];
  const buildings = read.buildings.flatMap((e) => anchorNodeOf(world, e) ?? []);
  const corridors = depositsOf(env, read.origin).map((at) => corridorSamples(read.origin, at));
  const from = anchorNodeOf(world, scout);
  const post = signpostTargetAround(world, ctx, seat, read.store, buildings, corridors, from);
  return post === null ? [] : [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
}

/**
 * Founding and running: the colony raises {@link COLONY_BUILDS}, posts its men by {@link POSTS}, marries and
 * houses its people. It runs on, not stopping at `running`, so a post whose man fell is filled by the next
 * free one. `running` starts once the store stands, the hold is empty and a gatherer works.
 */
export function foundColony(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const buildings = colonyBuildings(env);
  const origin = colonyOrigin(env, colony, buildings);
  if (origin === null) return [];
  const store = storeOf(env, buildings);
  const read: FoundingRead = { buildings, store, origin };
  const people = colonists(env);
  const men = people.filter((e) => isAllocatableMan(world, ctx, e));
  const working = men.some((e) => liveWorkFlag(world, e) !== undefined);
  if (colony.phase === 'founding' && store !== null && isBuilt(world, store) && working) {
    if (colony.ship === null || unloaded(env, colony, colony.ship)) env.edit().phase = 'running';
  }
  return [
    ...nextBuild(env, colony, read),
    ...fillPosts(env, colony, men, read),
    ...raiseSignposts(env, men, read),
    ...colonyFamilies(world, ctx, people, buildings),
  ];
}
