import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  Female,
  Livestock,
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
import {
  buildingTypeByContentId,
  goodTypeByContentId,
  tiersAtOrAbove,
} from '../../ai-shared/content-lookup.js';
import { colonySettlersOn } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { claimableBy, herdOf } from '../../livestock/index.js';
import { isScoutJob, isTraderJob } from '../../readviews/index.js';
import { playerSeesNode } from '../../vision/gates.js';
import { HERD_PAIR } from '../herd.js';
import { nearestLiveResource, reachableResourceTest, workableResourceTest } from '../live-resources.js';
import { SCOUT_CATCH_RADIUS_NODES, scoutBusy } from '../scout/index.js';
import { corridorSamples, signpostTargetAround } from '../scout/signpost-coverage.js';
import { enabledTiersAbove, liftCommand, liftTarget } from '../top-tier.js';
import { COLONY_SPOT_NODES } from './industry-read.js';
import { isOverflowBuilding } from './overflow.js';
import { colonyFamilies, standsOn } from './people.js';
import { COLONY_OPEN_SITES, colonyPlan, farStep, stepGround } from './plan.js';
import { type FoundingRead, fillPosts } from './posts.js';
import { colonyFoodHeld, LAND_GOOD_IDS } from './provision.js';
import { colonyBuildings, colonySpot, workshopSpot } from './spot.js';
import { colonyStoreType, liftStore } from './store-tier.js';
import { COLONY_STORE_BUILDING_ID } from './survey.js';
import { isColonyTower, towerAnchor } from './towers.js';
import { type ColonyEnv, type ColonyView, unloaded } from './voyage.js';

/** How far from the first store a deposit gets a second one, in Manhattan nodes (authored: a hold's hands'
 *  reach, past which the carriers' trips outweigh a store's bill). */
const SECOND_STORE_NODES = 40;
/** The animal farm whose herd the colony's scout rounds up. */
const ANIMAL_FARM_ID = 'work_animal_farm';
/** The people standing on the colony: its members on its land. A man listed for the ferry but still walking
 *  to the ship is not one yet, or a workshop on the far shore would post him; the trader only calls there. */
export function colonists(env: ColonyEnv): Entity[] {
  const { world, ctx, seat } = env;
  const { land } = env.colony;
  return colonySettlersOn(world, ctx, seat, land).filter(
    (e) =>
      !world.has(e, Rider) &&
      world.has(e, Position) &&
      standsOn(world, ctx, e, land) &&
      !isTraderJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** The colony's first store at any tier, standing, upgrading or a site. */
export function storeOf(env: ColonyEnv, buildings: readonly Entity[]): Entity | null {
  const { world, ctx } = env;
  const store = buildingTypeByContentId(ctx.content, COLONY_STORE_BUILDING_ID);
  if (store === undefined) return null;
  const tiers = tiersAtOrAbove(contentIndex(ctx.content), store);
  return buildings.find((e) => tiers.has(world.get(e, Building).buildingType)) ?? null;
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
 *  the anchor is a real node on the land, the shore while no store stands, then the store, and a tower's
 *  own ({@link towerAnchor}). */
function nextBuild(env: ColonyEnv, colony: ColonyView, read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const index = contentIndex(ctx.content);
  if (tribe === undefined) return [];
  const open = read.buildings.filter((e) => world.has(e, UnderConstruction)).length;
  if (open >= COLONY_OPEN_SITES) return [];
  const { plan } = read;
  // The first store goes up alone: another site would take the bill the founding ship brought for it, and
  // the trader that brings the rest waits for that store.
  if (colony.phase === 'founding' && read.store !== null && !isBuilt(world, read.store)) return [];
  for (const building of read.store === null ? plan.slice(0, 1) : plan) {
    const typeId = index.buildingTypeBySlug.get(building);
    const type = typeId === undefined ? undefined : index.buildings.get(typeId);
    if (type === undefined) continue;
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
    return [placementOf(type.typeId, spot, tribe, seat)];
  }
  return plan.length === 0 ? secondStore(env, colony, read, tribe) : [];
}

/** A second store by the wood when the nearest stands past {@link SECOND_STORE_NODES} of the first. */
function secondStore(env: ColonyEnv, colony: ColonyView, read: FoundingRead, tribe: number): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  const type = colonyStoreType(world, ctx, seat);
  const wood = goodTypeByContentId(ctx.content, 'wood');
  if (type === undefined || wood === undefined || read.store === null) return [];
  const index = contentIndex(ctx.content);
  const base = buildingTypeByContentId(ctx.content, COLONY_STORE_BUILDING_ID);
  const tiers = base === undefined ? new Set<number>() : tiersAtOrAbove(index, base);
  const stores = colony.builds.filter((b) => tiers.has(index.buildingTypeBySlug.get(b.building) ?? -1));
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
  const spot = colonySpot(env, colony.land, type, tribe, at, COLONY_SPOT_NODES);
  if (spot === null) return [];
  env.edit().builds.push({ building: type.id, placed: true });
  return [placementOf(type.typeId, spot, tribe, seat)];
}

/** With nothing else to raise, a fed colony of women lifts one building, its homes first: a home straight to
 *  the top tier enabled (owner ruling: the line supplies its materials), any other a tier. What the bill takes
 *  past its land and workshops sails from home. A store goes up by `./store-tier.ts` instead. */
function nextUpgrade(env: ColonyEnv, read: FoundingRead, people: readonly Entity[]): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const open = read.buildings.some((e) => world.has(e, UnderConstruction));
  if (open || read.plan.length > 0) return [];
  if (!people.some((e) => world.has(e, Female))) return [];
  if (colonyFoodHeld(env, read.buildings) < people.length) return [];
  const index = contentIndex(ctx.content);
  const liftable = read.buildings.flatMap((building) => {
    const house = world.get(building, Building);
    const type = index.buildings.get(house.buildingType);
    if (type === undefined || type.kind === BUILDING_KIND.storage || !isBuilt(world, building)) return [];
    const home = type.kind === BUILDING_KIND.home;
    const target = home
      ? liftTarget(world, ctx, seat, building)
      : enabledTiersAbove(world, ctx, seat, house.tribe, type)[0];
    return target === undefined ? [] : [{ building, target, home }];
  });
  const lift = liftable.find((b) => b.home) ?? liftable[0];
  return lift === undefined ? [] : [liftCommand(lift.building, lift.target)];
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

/** The animals a colony's farm holds before its scout stops rounding up wild ones (authored): two breeding
 *  pairs, so one lost leaves the farm breeding. */
const COLONY_HERD = 2 * HERD_PAIR;

/** The wild animal the colony's scout rounds up next (owner ruling: husbandry where the scout can capture
 *  animals), or null: while an animal farm stands there short of {@link COLONY_HERD}, the claimable one he
 *  sees on its land within his catch reach of `read`'s origin nearest him, the lowest id on a tie. A claimed
 *  animal joins a farm on its own land. Cost: the livestock, only while such a farm is short. */
function herdToClaim(env: ColonyEnv, scout: Entity, read: FoundingRead): Entity | null {
  const { world, ctx, terrain, seat } = env;
  const farm = buildingTypeByContentId(ctx.content, ANIMAL_FARM_ID);
  const farms = read.buildings.filter(
    (e) => world.get(e, Building).buildingType === farm?.typeId && isBuilt(world, e),
  );
  const held = farms.reduce((sum, e) => sum + herdOf(world, e).length, 0);
  const at = anchorNodeOf(world, scout);
  if (farms.length === 0 || held >= COLONY_HERD || at === null) return null;
  let best: { readonly animal: Entity; readonly distance: number } | null = null;
  for (const animal of world.query(Livestock, Position)) {
    const node = anchorNodeOf(world, animal);
    if (node === null || !terrain.inBounds(node.hx, node.hy) || !claimableBy(world, animal, seat)) continue;
    if (terrain.componentOf(terrain.nodeAt(node.hx, node.hy)) !== env.colony.land) continue;
    if (nodeManhattan(node, read.origin) > SCOUT_CATCH_RADIUS_NODES) continue;
    if (!playerSeesNode(ctx.fog, seat, node.hx, node.hy)) continue;
    const distance = nodeManhattan(node, at);
    if (best === null || distance < best.distance || (distance === best.distance && animal < best.animal))
      best = { animal, distance };
  }
  return best?.animal ?? null;
}

/** The colony's one scout rounds up its farm's herd ({@link herdToClaim}), else carries its lattice round
 *  what stands there and out to its land's deposits. */
function raiseSignposts(env: ColonyEnv, men: readonly Entity[], read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const scout = men.find((e) => isScoutJob(ctx.content, world.get(e, Settler).jobType));
  if (scout === undefined || read.store === null || scoutBusy(world, ctx, scout)) return [];
  const animal = herdToClaim(env, scout, read);
  if (animal !== null) return [{ kind: 'claimAnimal', entity: scout, animal }];
  const buildings = read.buildings.flatMap((e) => anchorNodeOf(world, e) ?? []);
  const corridors = depositsOf(env, read.origin).map((at) => corridorSamples(read.origin, at));
  const from = anchorNodeOf(world, scout);
  const post = signpostTargetAround(world, ctx, seat, read.store, buildings, corridors, from);
  return post === null ? [] : [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
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
  const read: FoundingRead = { buildings, store, origin, plan: colonyPlan(env, colony, buildings) };
  const people = colonists(env);
  const men = people.filter((e) => isAllocatableMan(world, ctx, e));
  const working = men.some((e) => liveWorkFlag(world, e) !== undefined);
  if (colony.phase === 'founding' && store !== null && isBuilt(world, store) && working) {
    if (colony.ship === null || unloaded(env, colony, colony.ship)) env.edit().phase = 'running';
  }
  const lift = liftStore(env, colony, read);
  return [
    ...(lift.length > 0 ? lift : [...nextBuild(env, colony, read), ...nextUpgrade(env, read, people)]),
    ...fillPosts(env, men, read),
    ...raiseSignposts(env, men, read),
    ...colonyFamilies(world, ctx, people, buildings),
  ];
}
