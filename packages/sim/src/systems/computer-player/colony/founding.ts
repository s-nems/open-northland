import {
  Building,
  FishSwarm,
  JobAssignment,
  Position,
  playerPlacementTribes,
  Rider,
  Settler,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { everySettlerOf, homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf, nearestRingNode } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { builderJobOf, isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { hunterJobType, isFisherJob, isHunterJob, isScoutJob, scoutJobType } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { isCarrierJob } from '../../stores/workplace.js';
import {
  knownResourceTest,
  nearestLiveResource,
  reachableResourceTest,
  type WorkableTest,
  workableResourceTest,
} from '../live-resources.js';
import { scoutBusy } from '../scout/index.js';
import { signpostTargetAround } from '../scout/signpost-coverage.js';
import { genericCollectorJob } from '../workforce/collectors/wanted-goods.js';
import { FISHER_FLAG_MAX_DISTANCE_NODES, FISHING_TRIP_RADIUS_NODES } from '../workforce/fisher.js';
import {
  claimFlagNode,
  collectorSpot,
  type FlagGround,
  flagGround,
  legalFlagNodeTest,
  type TakenFlagNodes,
} from '../workforce/flag-spots.js';
import { colonyFamilies } from './people.js';
import { colonyBuildings, colonySpot } from './spot.js';
import { COLONY_STORE_BUILDING_ID } from './survey.js';
import { type ColonyEnv, type ColonyView, unloaded } from './voyage.js';

/** What a colony raises, in order (authored): a store, four homes, no road, no farm, no tower. */
export const COLONY_BUILDS: readonly string[] = [
  COLONY_STORE_BUILDING_ID,
  'home_level_00',
  'home_level_00',
  'home_level_00',
  'home_level_00',
];
/** The open sites a colony's builders work at once (authored): its hold pays for little more. */
const COLONY_OPEN_SITES = 2;
/** How far from its anchor a building's spot may lie, in Manhattan nodes (authored: the walk range). */
const SPOT_SEARCH_NODES = 50;
/** How far from the first store a deposit gets a second one, in Manhattan nodes (authored: a hold's hands'
 *  reach, past which the carriers' trips outweigh a store's bill). */
const SECOND_STORE_NODES = 40;
/** The builders a colony keeps once nothing is left to raise (authored): a pair for a lost building, and
 *  every other man digs, which is what the colony is for. */
const BUILDERS_AT_REST = 2;

type Gathered = 'wood' | 'stone';
type Post = 'builder' | 'carrier' | Gathered | 'hunter' | 'fisher' | 'scout';

/**
 * The men's posts, filled in this order as the party's size allows (authored). 4 builders, 2 carriers, 4 on
 * wood, 3 on stone, 2 hunters, 2 fishers and a scout make 18, more than the largest party's 15, so the
 * tail is what a small party goes without: gatherers and builders first, or a party of 8 digs nothing.
 */
const POSTS: readonly Post[] = [
  'builder',
  'builder',
  'wood',
  'carrier',
  'builder',
  'wood',
  'stone',
  'hunter',
  'carrier',
  'scout',
  'wood',
  'builder',
  'stone',
  'fisher',
  'hunter',
  'wood',
  'stone',
  'fisher',
];

/** The post `e` holds, read from the world, or null for a man free to take one. */
function postOf(world: World, ctx: SystemContext, e: Entity, builder: number | null): Post | null {
  const job = world.get(e, Settler).jobType;
  if (isScoutJob(ctx.content, job)) return 'scout';
  if (isFisherJob(ctx.content, job)) return 'fisher';
  if (job !== null && isHunterJob(ctx.content, job)) return 'hunter';
  if (job !== null && world.has(e, JobAssignment) && isCarrierJob(ctx, job)) return 'carrier';
  if (liveWorkFlag(world, e) !== undefined) {
    const good = heldGatherGood(world, ctx, e);
    return good === goodTypeByContentId(ctx.content, 'wood')?.typeId
      ? 'wood'
      : good === goodTypeByContentId(ctx.content, 'stone')?.typeId
        ? 'stone'
        : null;
  }
  return job === builder ? 'builder' : null;
}

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

/** One founding decision's reads. */
interface FoundingRead {
  readonly buildings: readonly Entity[];
  readonly store: Entity | null;
  readonly origin: HalfCellNode;
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
  const row = colony.builds.findIndex((b) => !b.placed);
  const entry = colony.builds[row];
  const typeId = entry === undefined ? undefined : index.buildingTypeBySlug.get(entry.building);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  if (entry === undefined || type === undefined) return secondStore(env, colony, read, tribe);
  const spot = colonySpot(env, colony.land, type, tribe, read.origin, SPOT_SEARCH_NODES);
  if (spot === null) return [];
  const live = env.edit().builds[row];
  if (live !== undefined) live.placed = true;
  return [placementOf(type.typeId, spot, tribe, seat)];
}

/** Which of a good's resources `origin`'s men may work: known to the seat and inside its reach. */
function workableFrom(env: ColonyEnv, origin: HalfCellNode, ground: FlagGround): WorkableTest {
  const { world, ctx, terrain, seat } = env;
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    origin,
    workableResourceTest(world, ctx, terrain),
  );
  const known = knownResourceTest(world, ctx, seat);
  const door = terrain.nodeAtClamped(origin.hx, origin.hy);
  const { limit } = ground;
  return (e) =>
    reachable(e) &&
    (known === null || known(e)) &&
    (limit === null || limit.allowsNode(interactionCell(world, ctx, terrain, e, door)));
}

/** A second store by the wood when the nearest stands past {@link SECOND_STORE_NODES} of the first. */
function secondStore(env: ColonyEnv, colony: ColonyView, read: FoundingRead, tribe: number): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  const index = contentIndex(ctx.content);
  const typeId = index.buildingTypeBySlug.get(COLONY_STORE_BUILDING_ID);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  const wood = goodTypeByContentId(ctx.content, 'wood');
  if (type === undefined || wood === undefined || read.store === null) return [];
  if (colony.builds.length > COLONY_BUILDS.length) return [];
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
  const spot = colonySpot(env, colony.land, type, tribe, at, SPOT_SEARCH_NODES);
  if (spot === null) return [];
  env.edit().builds.push({ building: COLONY_STORE_BUILDING_ID, placed: true });
  return [placementOf(type.typeId, spot, tribe, seat)];
}

/** The nearest live fish shore from `origin` a flag may stand on, or null. */
function fishSpot(
  env: ColonyEnv,
  origin: HalfCellNode,
  ground: FlagGround,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const { world, terrain } = env;
  const land = terrain.componentOf(terrain.nodeAtClamped(origin.hx, origin.hy));
  let best: { readonly node: number; readonly distance: number } | null = null;
  for (const e of fishSwarmsNearNode(world, origin.hx, origin.hy, FISHING_TRIP_RADIUS_NODES)) {
    const swarm = world.get(e, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null || terrain.componentOf(swarm.shore) !== land) continue;
    const { x, y } = terrain.coordsOf(swarm.shore);
    const distance = nodeManhattan({ hx: x, hy: y }, origin);
    if (best === null || distance < best.distance || (distance === best.distance && swarm.shore < best.node))
      best = { node: swarm.shore, distance };
  }
  if (best === null) return null;
  const { x, y } = terrain.coordsOf(best.node as NodeId);
  return nearestRingNode(x, y, 0, FISHER_FLAG_MAX_DISTANCE_NODES, origin, legalFlagNodeTest(ground, taken));
}

/** The orders that put `man` on `post`, or null while the post cannot take him. */
function postOrders(
  env: ColonyEnv,
  man: Entity,
  post: Post,
  read: FoundingRead,
  ground: () => FlagGround,
  taken: TakenFlagNodes,
): PlayerCommand[] | null {
  const { world, ctx } = env;
  const subject = needSubjectOf(world, man);
  const qualified = (job: number): boolean => settlerMeetsNeed(world, ctx, subject, 'job', job);
  if (post === 'builder') {
    const job = builderJobOf(ctx);
    return job === null ? null : [{ kind: 'setJob', entity: man, jobType: job }];
  }
  if (post === 'scout') {
    const job = scoutJobType(ctx.content);
    return job === null || !qualified(job) ? null : [{ kind: 'setJob', entity: man, jobType: job }];
  }
  if (post === 'wood' || post === 'stone') {
    const good = goodTypeByContentId(ctx.content, post);
    const job = genericCollectorJob(ctx);
    if (good === undefined || job === null) return null;
    const flags = ground();
    const spot = collectorSpot(
      world,
      flags,
      read.origin,
      good.typeId,
      taken,
      workableFrom(env, read.origin, flags),
    );
    if (spot === null) return null;
    claimFlagNode(taken, spot);
    return [
      { kind: 'setJob', entity: man, jobType: job },
      { kind: 'setWorkFlag', entity: man, x: spot.hx, y: spot.hy },
      { kind: 'setGatherGood', entity: man, goodType: good.typeId },
    ];
  }
  const store = read.store;
  if (store === null || !isBuilt(world, store)) return null;
  const type = contentIndex(ctx.content).buildings.get(world.get(store, Building).buildingType);
  const seatJob = (test: (job: number) => boolean): number | undefined =>
    type?.workers.find((slot) => test(slot.jobType))?.jobType;
  if (post === 'carrier') {
    const job = seatJob((j) => isCarrierJob(ctx, j));
    return job === undefined
      ? null
      : [{ kind: 'assignWorker', entity: man, building: store, jobPriority: [job] }];
  }
  if (post === 'hunter') {
    const job = hunterJobType(ctx.content);
    const offered = job !== null && seatJob((j) => j === job) !== undefined;
    return !offered || job === null || !qualified(job)
      ? null
      : [{ kind: 'assignWorker', entity: man, building: store, jobPriority: [job] }];
  }
  const job = seatJob((j) => isFisherJob(ctx.content, j));
  if (job === undefined || !qualified(job)) return null;
  const spot = fishSpot(env, read.origin, ground(), taken);
  if (spot === null) return null;
  claimFlagNode(taken, spot);
  return [
    { kind: 'assignWorker', entity: man, building: store, jobPriority: [job] },
    { kind: 'setWorkFlag', entity: man, x: spot.hx, y: spot.hy },
  ];
}

/** Whether the colony has raised all it means to, for now. */
function atRest(env: ColonyEnv, colony: ColonyView, read: FoundingRead): boolean {
  const { world } = env;
  return colony.builds.every((b) => b.placed) && !read.buildings.some((e) => world.has(e, UnderConstruction));
}

/** The posts of {@link POSTS} the men's number reaches that none holds, handed to the free men and to the
 *  builders past their share; with nothing left to raise, the rest dig, the scarcer good first; a free man
 *  with no post to take builds. */
function fillPosts(
  env: ColonyEnv,
  colony: ColonyView,
  men: readonly Entity[],
  read: FoundingRead,
): PlayerCommand[] {
  const { world, ctx, terrain, seat } = env;
  const builder = builderJobOf(ctx);
  const held = new Map<Post, number>();
  const builders: Entity[] = [];
  const free: Entity[] = [];
  for (const man of men) {
    const post = postOf(world, ctx, man, builder);
    if (post === null) free.push(man);
    else held.set(post, (held.get(post) ?? 0) + 1);
    if (post === 'builder') builders.push(man);
  }
  const dug = { wood: held.get('wood') ?? 0, stone: held.get('stone') ?? 0 };
  const resting = atRest(env, colony, read);
  const open = POSTS.slice(0, men.length).filter((post) => {
    const standing = held.get(post) ?? 0;
    held.set(post, standing - 1);
    return standing <= 0;
  });
  // Men who built while their post could not take them yet go to it now.
  const past = resting
    ? builders.slice(BUILDERS_AT_REST)
    : builders.slice(0, Math.max(0, held.get('builder') ?? 0));
  const spare = [...free, ...past];
  if (spare.length === 0) return [];
  let flags: FlagGround | null = null;
  const ground = (): FlagGround => {
    flags ??= flagGround(
      world,
      ctx,
      terrain,
      networkLimitAt(world, terrain, seat, read.origin.hx, read.origin.hy),
      'aimed',
    );
    return flags;
  };
  const taken: TakenFlagNodes = new Set();
  const commands: PlayerCommand[] = [];
  for (const post of open) {
    const man = spare[0];
    if (man === undefined) break;
    const orders = postOrders(env, man, post, read, ground, taken);
    if (orders === null) continue;
    commands.push(...orders);
    spare.shift();
    if (post === 'wood' || post === 'stone') dug[post]++;
  }
  while (resting) {
    const man = spare[0];
    if (man === undefined) break;
    const goods: readonly Gathered[] = dug.stone <= dug.wood ? ['stone', 'wood'] : ['wood', 'stone'];
    const good = goods.find((g) => {
      const orders = postOrders(env, man, g, read, ground, taken);
      if (orders !== null) commands.push(...orders);
      return orders !== null;
    });
    if (good === undefined) break;
    dug[good]++;
    spare.shift();
  }
  if (builder !== null)
    for (const man of spare)
      if (world.get(man, Settler).jobType !== builder)
        commands.push({ kind: 'setJob', entity: man, jobType: builder });
  return commands;
}

/** The colony's one scout carries its lattice round what stands there. */
function raiseSignposts(env: ColonyEnv, men: readonly Entity[], read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const scout = men.find((e) => isScoutJob(ctx.content, world.get(e, Settler).jobType));
  if (scout === undefined || read.store === null || scoutBusy(world, ctx, scout)) return [];
  const buildings = read.buildings.flatMap((e) => anchorNodeOf(world, e) ?? []);
  const post = signpostTargetAround(world, ctx, seat, read.store, buildings, [], anchorNodeOf(world, scout));
  return post === null ? [] : [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
}

/**
 * Founding and running: the colony raises {@link COLONY_BUILDS}, posts its men by {@link POSTS}, marries and
 * houses its people. It runs on, not stopping at `running`, so a post whose man fell is filled by the next
 * free one. `running` starts once the store stands, the hold is empty and a gatherer works.
 */
export function foundColony(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  if (colony.shore === null) return [];
  const buildings = colonyBuildings(env);
  const store = storeOf(env, buildings);
  const origin = (store === null ? null : anchorNodeOf(world, store)) ?? {
    hx: colony.shore.hx,
    hy: colony.shore.hy,
  };
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
