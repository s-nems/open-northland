import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import {
  AttackOrder,
  Building,
  CurrentAtomic,
  FishSwarm,
  JobAssignment,
  Marriage,
  Settler,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { nearestRingNode } from '../../ai-shared/node-geometry.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { builderJobOf, isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { HUNT_CHASE_SLACK_NODES } from '../../conflict/hunting/index.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { hunterJobType, isFisherJob, isHunterJob, isScoutJob, scoutJobType } from '../../readviews/index.js';
import { fishSwarmsNearNode } from '../../spatial/fish.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { isCarrierJob } from '../../stores/workplace.js';
import { genericCollectorJob } from '../workforce/collectors/wanted-goods.js';
import { FISHER_FLAG_MAX_DISTANCE_NODES, FISHING_TRIP_RADIUS_NODES } from '../workforce/fisher.js';
import {
  claimFlagNode,
  collectorSpot,
  type FlagGround,
  legalFlagNodeTest,
  type TakenFlagNodes,
} from '../workforce/flag-spots.js';
import { huntWorkLeft } from '../workforce/hunter.js';
import { rowPlan } from '../workforce/staffing-rows.js';
import { colonists, colonyOrigin, storeOf } from './founding.js';
import { homeSupply } from './home-supply.js';
import { MEN_PER_WOMAN } from './people.js';
import { billsOf, COLONY_OPEN_SITES, colonyPlan, homeSlots } from './plan.js';
import {
  canDig,
  colonyFed,
  flagGroundAt,
  kitchenMouths,
  LAND_GOOD_IDS,
  type LandGood,
  landHolds,
  MOUTHS_PER_FOOD_HAND,
  storesHeld,
  workableFrom,
} from './provision.js';
import { colonyBuildings } from './spot.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** The builders a colony keeps once nothing is left to raise (authored): a pair for a lost building, and
 *  every other man digs, which is what the colony is for. */
const BUILDERS_AT_REST = 2;
/** The men on a good at most (authored): past these the colony's carriers cannot take in what they dig. */
const DIGGERS_MOST: Readonly<Record<LandGood, number>> = { wood: 4, stone: 4, mud: 2, iron: 2 };
/** The women a colony with a food hand gets before its food holds (authored): the couples its homes wait
 *  for, as a colony of men alone never grows whatever it eats. */
const WOMEN_FIRST = 2;
/** The men past its work a colony keeps before any sail home (authored): one lost to a fight or a change of
 *  plan is no reason for a ship to fetch another. */
const HANDS_SLACK = 1;

type Post = 'builder' | 'carrier' | LandGood | 'hunter' | 'fisher' | 'scout';

/**
 * The men's posts, filled in this order as the party's size allows (authored). Owner ruling: fishers first,
 * they may meet the hunger at the start. 4 builders, 2 carriers, 4 on wood, 3 on stone, 3 hunters, 3 fishers
 * and a scout make 20, more than the largest party's 15, so the tail is what a small party goes without.
 * Three of each food hand: on arabskie_wyspy_wolna_gra_mieszana two and two brought about 3.5 food a game
 * minute to colonies of 30 eating 4, and their stores stood empty.
 */
const POSTS: readonly Post[] = [
  'builder',
  'fisher',
  'builder',
  'wood',
  'carrier',
  'fisher',
  'hunter',
  'fisher',
  'wood',
  'stone',
  'hunter',
  'builder',
  'carrier',
  'scout',
  'wood',
  'builder',
  'stone',
  'hunter',
  'wood',
  'stone',
];

function isDug(post: Post | null): post is LandGood {
  return post !== null && (LAND_GOOD_IDS as readonly string[]).includes(post);
}

/** One founding decision's reads. */
export interface FoundingRead {
  readonly buildings: readonly Entity[];
  readonly store: Entity | null;
  readonly origin: HalfCellNode;
  /** What it means to raise ({@link colonyPlan}). */
  readonly plan: readonly string[];
}

/** The post `e` holds, read from the world, or null for a man free to take one. */
function postOf(world: World, ctx: SystemContext, e: Entity, builder: number | null): Post | null {
  const job = world.get(e, Settler).jobType;
  if (isScoutJob(ctx.content, job)) return 'scout';
  if (isFisherJob(ctx.content, job)) return 'fisher';
  if (job !== null && isHunterJob(ctx.content, job)) return 'hunter';
  if (job !== null && world.has(e, JobAssignment) && isCarrierJob(ctx, job)) return 'carrier';
  if (liveWorkFlag(world, e) !== undefined) {
    const good = heldGatherGood(world, ctx, e);
    return LAND_GOOD_IDS.find((id) => goodTypeByContentId(ctx.content, id)?.typeId === good) ?? null;
  }
  return job === builder ? 'builder' : null;
}

/** The nearest live fish shore on `origin`'s land, or null. */
function fishNear(env: ColonyEnv, origin: HalfCellNode): number | null {
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
  return best === null ? null : best.node;
}

/** The nearest spot a flag may stand on by a live fish shore from `origin`, or null. */
function fishSpot(
  env: ColonyEnv,
  origin: HalfCellNode,
  ground: FlagGround,
  taken: TakenFlagNodes,
): HalfCellNode | null {
  const shore = fishNear(env, origin);
  if (shore === null) return null;
  const { x, y } = env.terrain.coordsOf(shore as NodeId);
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
  if (isDug(post)) {
    const good = goodTypeByContentId(ctx.content, post);
    const job = genericCollectorJob(ctx);
    if (good === undefined || job === null) return null;
    if (!settlerMeetsNeed(world, ctx, subject, 'good', good.typeId)) return null;
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
  // Owner ruling: a fisher sets his catch down on the shore by his water and the store's carriers take it
  // from there. A flag fisher drops it at his flag; one employed at the store walks every fish to it.
  const job = ctx.content.jobs.find((j) => isFisherJob(ctx.content, j.typeId))?.typeId;
  if (job === undefined || !qualified(job)) return null;
  const spot = fishSpot(env, read.origin, ground(), taken);
  if (spot === null) return null;
  claimFlagNode(taken, spot);
  return [
    { kind: 'setJob', entity: man, jobType: job },
    { kind: 'setWorkFlag', entity: man, x: spot.hx, y: spot.hy },
  ];
}

/** Whether game is left for the colony's hunters among `men`: on their ground, past it by the chase's
 *  leash while one hunts, or on the store's while none does. Owner ruling: hunters kill the game quickly and
 *  then stand idle, so with none left the hunter post closes and its men take other work. */
function gameLeft(env: ColonyEnv, store: Entity | null, men: readonly Entity[]): boolean {
  const { world, ctx } = env;
  const job = hunterJobType(ctx.content);
  if (store === null || job === null || !isBuilt(world, store)) return false;
  const hunters = men.filter((e) => world.get(e, Settler).jobType === job);
  return huntWorkLeft(world, ctx, store, job, hunters, hunters.length > 0 ? HUNT_CHASE_SLACK_NODES : 0);
}

/** Whether `e` is mid-action or sent at an animal: a post change waits for him. */
function busy(world: World, e: Entity): boolean {
  return world.has(e, CurrentAtomic) || world.has(e, AttackOrder);
}

/** Whether the colony has raised all it means to, for now. */
function atRest(env: ColonyEnv, read: FoundingRead): boolean {
  return read.plan.length === 0 && !read.buildings.some((e) => env.world.has(e, UnderConstruction));
}

/** The units the colony's standing stores can still take of a good, unbounded while none stands: its
 *  gatherers work from the first day and heap what they dig. */
function storeRoom(env: ColonyEnv, buildings: readonly Entity[]): (good: number) => number {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const stores = buildings.filter(
    (e) =>
      isBuilt(world, e) &&
      index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  if (stores.length === 0) return () => Number.POSITIVE_INFINITY;
  const held = storesHeld(env, stores);
  return (good) => {
    let room = -(held.get(good) ?? 0);
    for (const e of stores)
      room += index.stockSlotCapacityByBuilding.get(world.get(e, Building).buildingType)?.get(good) ?? 0;
    return room;
  };
}

/**
 * What the colony has reason to dig, from what its land holds: wood and stone, as home always wants them, and
 * clay and iron while the colony's own plan, sites or workshops or home's stock call for them.
 */
function digGoods(env: ColonyEnv, read: FoundingRead): Set<LandGood> {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const called = billsOf(env, read.plan);
  for (const e of read.buildings) {
    const typeId = world.get(e, Building).buildingType;
    const inputs = index.mergedRecipeByBuilding.get(typeId)?.inputs;
    for (const input of inputs ?? []) called.set(input.goodType, input.amount);
    // A site still waits for its bill: a smithy's iron is dug while it stands unfinished.
    if (!world.has(e, UnderConstruction)) continue;
    for (const line of index.constructionBillByBuilding.get(typeId) ?? [])
      called.set(line.goodType, line.amount);
  }
  let supply: ReturnType<typeof homeSupply> | null = null;
  const wanted = (id: LandGood, good: number): boolean => {
    if (id === 'wood' || id === 'stone' || (called.get(good) ?? 0) > 0) return true;
    supply ??= homeSupply(env);
    return supply.lackToComfort(good) > 0;
  };
  const digs = new Set<LandGood>();
  for (const id of LAND_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good === undefined || !wanted(id, good)) continue;
    if (landHolds(env, read.origin, good)) digs.add(id);
  }
  return digs;
}

/** {@link digGoods} but those at the stores' cap: men left on one stand by a full warehouse while another
 *  good runs short. */
function digGoodsWithRoom(env: ColonyEnv, read: FoundingRead): Set<LandGood> {
  const room = storeRoom(env, read.buildings);
  const digs = digGoods(env, read);
  for (const id of digs) {
    const good = goodTypeByContentId(env.ctx.content, id)?.typeId;
    if (good !== undefined && room(good) <= 0) digs.delete(id);
  }
  return digs;
}

/** Each standing workshop's open seats, operators first and ascending by building: the trades men of the
 *  colony have earned sit down, taken off `spare` as they do, a digger at need, as digging is how a colony's
 *  man earns his trade. An empty workshop takes a hand off `movers`: the farmer who earned the mill moves up
 *  and a fresh man takes the farm. Only the gatherer's seats {@link colonySeats} lists are filled. */
function crewOrders(
  env: ColonyEnv,
  read: FoundingRead,
  spare: Entity[],
  diggers: Entity[],
  movers: Entity[],
): PlayerCommand[] {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const commands: PlayerCommand[] = [];
  const earned = (man: Entity, job: number): boolean =>
    settlerMeetsNeed(world, ctx, needSubjectOf(world, man), 'job', job);
  const seat = (type: BuildingType, e: Entity, carriers: boolean): void => {
    const held = assignedWorkers(world, e);
    for (const { jobType, count } of colonySeats(ctx, type)) {
      if (isCarrierJob(ctx, jobType) !== carriers) continue;
      let open = count - held.filter((w) => world.get(w, Settler).jobType === jobType).length;
      while (open-- > 0) {
        const fits = (man: Entity): boolean =>
          earned(man, jobType) && (world.get(man, Settler).jobType !== jobType || !movers.includes(man));
        const empty = held.length === 0;
        const pool = [spare, diggers, empty ? movers : []].find((men) => men.some(fits)) ?? spare;
        const at = pool.findIndex(fits);
        const man = pool[at];
        if (man === undefined) return;
        pool.splice(at, 1);
        commands.push({ kind: 'assignWorker', entity: man, building: e, jobPriority: [jobType] });
      }
    }
  };
  for (const carriers of [false, true]) {
    for (const e of read.buildings) {
      const type = index.buildings.get(world.get(e, Building).buildingType);
      if (type?.kind === BUILDING_KIND.workplace && isBuilt(world, e)) seat(type, e, carriers);
    }
  }
  return commands;
}

/** Whether `e` works a colony workshop: his seat is not a post of {@link POSTS}. */
export function atWorkshop(env: ColonyEnv, e: Entity): boolean {
  const { world, ctx } = env;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  const building = workplace === undefined ? undefined : world.tryGet(workplace, Building);
  if (building === undefined) return false;
  return contentIndex(ctx.content).buildings.get(building.buildingType)?.kind === BUILDING_KIND.workplace;
}

/** The gatherers a workshop seats for an input no digger of the colony digs (authored): one keeps a
 *  workshop's shelf of gold or mushrooms. */
const OWN_GATHERERS = 1;

/** Whether one of `type`'s recipes takes a good gathered off the map that the colony's diggers leave
 *  ({@link LAND_GOOD_IDS}): the mint's gold, the druid's mushrooms. Its own gatherer brings it. */
function gathersOwnInput(ctx: SystemContext, type: BuildingType): boolean {
  const index = contentIndex(ctx.content);
  const dug = new Set(LAND_GOOD_IDS.map((id) => goodTypeByContentId(ctx.content, id)?.typeId));
  return type.recipes.some((recipe) =>
    recipe.inputs.some((i) => !dug.has(i.goodType) && index.goods.get(i.goodType)?.gathering !== undefined),
  );
}

/**
 * The seats of each trade of `type` the colony fills: the shared staffing row's target tier, so a farm takes
 * two farmers, a mill one miller, a bakery one baker and its porter, and a well or a hive none (owner ruling:
 * the colony's farm crews ran every slot). A gatherer's seat stays open ({@link crewOrders}) but where the
 * workshop takes a good its diggers leave ({@link gathersOwnInput}).
 */
export function colonySeats(
  ctx: SystemContext,
  type: BuildingType,
): readonly { readonly jobType: number; readonly count: number }[] {
  const { plan } = rowPlan(ctx, type);
  const gatherer = genericCollectorJob(ctx);
  let carriers = plan.carrierTarget;
  return type.workers.flatMap(({ jobType, count }) => {
    if (jobType === gatherer)
      return gathersOwnInput(ctx, type) ? [{ jobType, count: Math.min(count, OWN_GATHERERS) }] : [];
    if (!isCarrierJob(ctx, jobType)) return [{ jobType, count: Math.min(count, plan.operatorTarget) }];
    const seated = Math.min(count, carriers);
    carriers -= seated;
    return seated > 0 ? [{ jobType, count: seated }] : [];
  });
}

/** The seats of `type` the colony fills, all trades together ({@link colonySeats}). */
function seatsOf(ctx: SystemContext, type: BuildingType): number {
  return colonySeats(ctx, type).reduce((sum, slot) => sum + slot.count, 0);
}

/** The mouths the food hands of `posts`, the ones the colony can fill, and its kitchens' crews feed. */
function mouthsFed(env: ColonyEnv, buildings: readonly Entity[], posts: readonly Post[]): number {
  const hands = posts.filter((post) => post === 'fisher' || post === 'hunter').length;
  return MOUTHS_PER_FOOD_HAND * hands + kitchenMouths(env, buildings);
}

/** The men and women the colony has work for now and can feed: a man idle there is a man lost at home. Owner
 *  ruling: people cross like goods. A colony needing hands for gatherers, sites or workshops gets men by
 *  the ferry, and once it eats well women for their share and for every slot of its homes. A good its stores
 *  cannot take calls no digger. */
export function handsWanted(
  env: ColonyEnv,
  colony: ColonyView,
): { readonly men: number; readonly women: number } {
  const { world, ctx } = env;
  const index = contentIndex(ctx.content);
  const buildings = colonyBuildings(env);
  const origin = colonyOrigin(env, colony, buildings);
  if (origin === null) return { men: 0, women: 0 };
  const plan = colonyPlan(env, colony, buildings);
  const read = { buildings, store: storeOf(env, buildings), origin, plan };
  const flags = flagGroundAt(env, origin);
  const diggable = [...digGoodsWithRoom(env, read)].filter((id) => {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    return good !== undefined && canDig(env, origin, good, flags);
  });
  const resting = atRest(env, read);
  let men = 0;
  for (const good of diggable) men += DIGGERS_MOST[good];
  const fishes = fishNear(env, origin) !== null;
  const people = colonists(env);
  const hunts = gameLeft(
    env,
    read.store,
    people.filter((e) => isAllocatableMan(world, ctx, e)),
  );
  const others = POSTS.filter(
    (p) =>
      !isDug(p) && (p !== 'builder' || !resting) && (p !== 'fisher' || fishes) && (p !== 'hunter' || hunts),
  );
  men += others.length + (resting ? BUILDERS_AT_REST : 0);
  for (const e of buildings) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type?.kind === BUILDING_KIND.workplace && !world.has(e, UnderConstruction)) men += seatsOf(ctx, type);
  }
  for (const building of plan.slice(0, COLONY_OPEN_SITES)) {
    const typeId = index.buildingTypeBySlug.get(building);
    const type = typeId === undefined ? undefined : index.buildings.get(typeId);
    if (type?.kind === BUILDING_KIND.workplace) men += seatsOf(ctx, type);
  }
  const fishing = people.some((e) => isFisherJob(ctx.content, world.get(e, Settler).jobType));
  const share = Math.max(Math.floor(men / MEN_PER_WOMAN), homeSlots(env, buildings).slots);
  const women = colonyFed(env, buildings, people) ? share : fishing ? WOMEN_FIRST : 0;
  return { men: Math.min(men, mouthsFed(env, buildings, others) - women), women };
}

/** The colony's men with no work left, who sail home by the next ship (owner ruling): its free builders past
 *  what it has work for, unwed first and then ascending id. */
export function menPastWork(env: ColonyEnv, colony: ColonyView): Entity[] {
  const { world, ctx } = env;
  if (colony.phase !== 'running') return [];
  const men = colonists(env).filter((e) => isAllocatableMan(world, ctx, e));
  const past = men.length - handsWanted(env, colony).men - HANDS_SLACK;
  if (past <= 0) return [];
  const builder = builderJobOf(ctx);
  return men
    .filter((e) => !atWorkshop(env, e) && postOf(world, ctx, e, builder) === 'builder')
    .sort((a, b) => Number(world.has(a, Marriage)) - Number(world.has(b, Marriage)) || a - b)
    .slice(BUILDERS_AT_REST)
    .slice(0, past);
}

/** The posts of {@link POSTS} the men's number reaches that none holds, handed to the free men and to the
 *  builders past their share, then the workshops' seats; with nothing left to raise, the rest dig, the
 *  least dug good first; a good a site needs and nobody digs goes first of all, as no ship brings what the
 *  land holds; a free man with no post to take builds. */
export function fillPosts(env: ColonyEnv, men: readonly Entity[], read: FoundingRead): PlayerCommand[] {
  const { world, ctx } = env;
  const builder = builderJobOf(ctx);
  const held = new Map<Post, number>();
  const builders: Entity[] = [];
  const free: Entity[] = [];
  const posted = men.filter((man) => !atWorkshop(env, man));
  const digs = digGoodsWithRoom(env, read);
  const hunting = gameLeft(env, read.store, posted);
  for (const man of posted) {
    const post = postOf(world, ctx, man, builder);
    // A man at a full store's good moves on while another good wants digging, a hunter once no game is left.
    const moves =
      (isDug(post) && !digs.has(post) && digs.size > 0) ||
      (post === 'hunter' && !hunting && !busy(world, man));
    if (post === null || moves) free.push(man);
    else held.set(post, (held.get(post) ?? 0) + 1);
    if (post === 'builder') builders.push(man);
  }
  const dug = new Map<LandGood, number>();
  for (const id of LAND_GOOD_IDS) dug.set(id, held.get(id) ?? 0);
  const resting = atRest(env, read);
  const table = POSTS.slice(0, posted.length).filter(
    (post) => (!isDug(post) || digs.has(post)) && (post !== 'hunter' || hunting),
  );
  const called = billsOf(env, read.plan);
  const urgent = LAND_GOOD_IDS.filter((id) => {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    return digs.has(id) && (dug.get(id) ?? 0) === 0 && good !== undefined && (called.get(good) ?? 0) > 0;
  });
  const open = [...urgent, ...table].filter((post) => {
    const standing = held.get(post) ?? 0;
    held.set(post, standing - 1);
    return standing <= 0;
  });
  // Men who built while their post could not take them yet go to it now.
  const past = resting
    ? builders.slice(BUILDERS_AT_REST)
    : builders.slice(0, Math.max(0, held.get('builder') ?? 0));
  const spare = [...free, ...past];
  const diggers = posted.filter((man) => isDug(postOf(world, ctx, man, builder)) && !spare.includes(man));
  const movers = men.filter((man) => {
    const job = world.get(man, Settler).jobType;
    const operator = atWorkshop(env, man) && job !== null && !isCarrierJob(ctx, job);
    const refilled = (other: Entity): boolean =>
      other !== man && job !== null && settlerMeetsNeed(world, ctx, needSubjectOf(world, other), 'job', job);
    return operator && posted.some(refilled);
  });
  const commands = crewOrders(env, read, spare, diggers, movers);
  if (spare.length === 0) return commands;
  let flags: FlagGround | null = null;
  const ground = (): FlagGround => {
    flags ??= flagGroundAt(env, read.origin);
    return flags;
  };
  const taken: TakenFlagNodes = new Set();
  for (const post of open) {
    const man = spare[0];
    if (man === undefined) break;
    const orders = postOrders(env, man, post, read, ground, taken);
    if (orders === null) continue;
    commands.push(...orders);
    spare.shift();
    if (isDug(post)) dug.set(post, (dug.get(post) ?? 0) + 1);
  }
  while (resting) {
    const man = spare[0];
    if (man === undefined) break;
    const goods = [...digs]
      .filter((g) => (dug.get(g) ?? 0) < DIGGERS_MOST[g])
      .sort((a, b) => (dug.get(a) ?? 0) - (dug.get(b) ?? 0));
    const good = goods.find((g) => {
      const orders = postOrders(env, man, g, read, ground, taken);
      if (orders !== null) commands.push(...orders);
      return orders !== null;
    });
    if (good === undefined) break;
    dug.set(good, (dug.get(good) ?? 0) + 1);
    spare.shift();
  }
  if (builder !== null)
    for (const man of spare)
      if (world.get(man, Settler).jobType !== builder)
        commands.push({ kind: 'setJob', entity: man, jobType: builder });
  return commands;
}
