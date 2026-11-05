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
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { nearestRingNode } from '../../../ai-shared/node-geometry.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import { builderJobOf, isAllocatableMan } from '../../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../../context.js';
import { heldGatherGood } from '../../../economy/gather-goods.js';
import { liveWorkFlag } from '../../../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../../../progression/index.js';
import {
  hunterJobType,
  isFisherJob,
  isHunterJob,
  isScoutJob,
  scoutJobType,
} from '../../../readviews/index.js';
import { fishSwarmsNearNode } from '../../../spatial/fish.js';
import { assignedWorkers } from '../../../stores/assigned-workers.js';
import { isCarrierJob } from '../../../stores/workplace.js';
import { sitesShortfalls } from '../../build-order/supply/upgrade-supply.js';
import { genericCollectorJob } from '../../workforce/collectors/wanted-goods.js';
import { FISHER_FLAG_MAX_DISTANCE_NODES, FISHING_TRIP_RADIUS_NODES } from '../../workforce/fisher.js';
import {
  claimFlagNode,
  collectorSpot,
  type FlagGround,
  legalFlagNodeTest,
  type TakenFlagNodes,
} from '../../workforce/flag-spots.js';
import { rowPlan } from '../../workforce/staffing-rows.js';
import type { ColonyEnv, ColonyView } from '../env.js';
import { homeSupply } from '../home-supply.js';
import { canDig, flagGroundAt, LAND_GOOD_IDS, landHolds, workableFrom } from '../land.js';
import { MEN_PER_WOMAN } from '../party.js';
import { colonists, colonyBuildings, colonyOrigin, storeOf } from '../roster.js';
import { colonyBuilderWant, withBuilderPosts } from './builders.js';
import { atWorkshop } from './craft.js';
import { farDigPorters } from './haulers.js';
import { huntingOpen } from './hunting.js';
import { earningDeposits } from './industry.js';
import { colonyIndustries } from './industry-read.js';
import { billsOf, COLONY_OPEN_SITES, colonyPlan, homeSlots } from './plan.js';
import { colonyFed, kitchenMouths, MOUTHS_PER_FOOD_HAND, storesHeld } from './provision.js';
import { colonyHand } from './school.js';

/** The men on a good at most (authored): past these the colony's carriers cannot take in what they dig. */
const DIGGERS_MOST: Readonly<Record<DugGood, number>> = {
  wood: 4,
  stone: 4,
  mud: 2,
  iron: 2,
  gold: 1,
  mushroom: 1,
};
/** What the colony's men dig: the land's goods; gold, which a mint's bill takes before its own gatherer
 *  sits down; and mushrooms, whose gathering earns the herb hut's trade where home has not. */
const DUG_IDS = [...LAND_GOOD_IDS, 'gold', 'mushroom'] as const;
type DugGood = (typeof DUG_IDS)[number];
/** The women a colony with a food hand gets before its food holds (authored): the couples its homes wait
 *  for, as a colony of men alone never grows whatever it eats. */
const WOMEN_FIRST = 2;
/** The men past its work a colony keeps before any sail home (authored): one lost to a fight or a change of
 *  plan is no reason for a ship to fetch another. */
const HANDS_SLACK = 1;

type Post = 'builder' | 'carrier' | DugGood | 'hunter' | 'fisher' | 'scout';

/**
 * The men's posts, filled in this order as the party's size allows (authored). Owner ruling: fishers first,
 * they may meet the hunger at the start. 4 builders, 2 carriers, 4 on wood, 3 on stone, 3 hunters, 3 fishers
 * and a scout make 20, more than the largest party's 15, so the tail is what a small party goes without.
 * The builder posts place the first builders; their number follows the sites ({@link colonyBuilderWant}).
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

/** `posts` with each hunter post a fisher's while the colony posts no hunter ({@link huntingOpen}): its food
 *  comes from the water instead. */
function withoutHunters(posts: readonly Post[], hunting: boolean): Post[] {
  return hunting ? [...posts] : posts.map((post) => (post === 'hunter' ? 'fisher' : post));
}

/** The porters the digs past the store's round want on top of `posts`, whose first carrier keeps the round:
 *  none before that one. */
function haulersBeyond(posts: readonly Post[], farDigs: number): number {
  const carriers = posts.filter((post) => post === 'carrier').length;
  return carriers === 0 ? 0 : Math.max(0, farDigs - (carriers - 1));
}

function isDug(post: Post | null): post is DugGood {
  return post !== null && (DUG_IDS as readonly string[]).includes(post);
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
    return DUG_IDS.find((id) => goodTypeByContentId(ctx.content, id)?.typeId === good) ?? null;
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

/** Whether `e` is mid-action or sent at an animal: a post change waits for him. */
function busy(world: World, e: Entity): boolean {
  return world.has(e, CurrentAtomic) || world.has(e, AttackOrder);
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
function digGoods(env: ColonyEnv, read: FoundingRead): Set<DugGood> {
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
  const industries = colonyIndustries(env, env.colony, read.buildings);
  const earning: readonly string[] =
    industries === null ? [] : earningDeposits(industries.choices, industries.read.open);
  let supply: ReturnType<typeof homeSupply> | null = null;
  const wanted = (id: DugGood, good: number): boolean => {
    if (id === 'wood' || id === 'stone' || (called.get(good) ?? 0) > 0 || earning.includes(id)) return true;
    supply ??= homeSupply(env);
    return supply.lackToComfort(good) > 0;
  };
  const digs = new Set<DugGood>();
  for (const id of DUG_IDS) {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    if (good === undefined || !wanted(id, good)) continue;
    if (landHolds(env, read.origin, good)) digs.add(id);
  }
  return digs;
}

/** {@link digGoods} but those at the stores' cap: men left on one stand by a full warehouse while another
 *  good runs short. */
function digGoodsWithRoom(env: ColonyEnv, read: FoundingRead): Set<DugGood> {
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
  let men = colonyBuilderWant(world, ctx, buildings, plan.length);
  for (const good of diggable) men += DIGGERS_MOST[good];
  const fishes = fishNear(env, origin) !== null;
  const people = colonists(env);
  const hunts = huntingOpen(
    env,
    read.store,
    people.filter((e) => isAllocatableMan(world, ctx, e)),
    fishes || kitchenMouths(env, buildings) > 0,
  );
  const others = withoutHunters(POSTS, hunts).filter(
    (p) => !isDug(p) && p !== 'builder' && (p !== 'fisher' || fishes),
  );
  men += others.length;
  men += haulersBeyond(others, farDigPorters(env, read.store));
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
 *  its sites' crew ({@link colonyBuilderWant}) and past what it has work for, unwed first and then ascending
 *  id, so the crew it keeps is its wed men first. */
export function menPastWork(env: ColonyEnv, colony: ColonyView): Entity[] {
  const { world, ctx } = env;
  if (colony.phase !== 'running') return [];
  const men = colonists(env).filter((e) => isAllocatableMan(world, ctx, e));
  const hands = colonists(env).filter((e) => colonyHand(world, ctx, e)).length;
  const past = hands - handsWanted(env, colony).men - HANDS_SLACK;
  if (past <= 0) return [];
  const builder = builderJobOf(ctx);
  const buildings = colonyBuildings(env);
  const crew = colonyBuilderWant(world, ctx, buildings, colonyPlan(env, colony, buildings).length);
  const builders = men
    .filter((e) => !atWorkshop(env, e) && postOf(world, ctx, e, builder) === 'builder')
    .sort((a, b) => Number(world.has(a, Marriage)) - Number(world.has(b, Marriage)) || a - b);
  return builders.slice(0, Math.min(past, Math.max(0, builders.length - crew)));
}

/** The `diggers` past the table's dig posts, in `held`'s surplus of each good, that the open builder posts of
 *  `open` call back once the `spare` men run short: a site that opens after another finished gets its pair
 *  back from the men the dig loop took. Not a man mid-action; the highest ids first. */
function diggersForBuilders(
  env: ColonyEnv,
  open: readonly Post[],
  spare: number,
  diggers: readonly Entity[],
  held: ReadonlyMap<Post, number>,
): Entity[] {
  const { world, ctx } = env;
  let short = open.filter((post) => post === 'builder').length - spare;
  if (short <= 0) return [];
  const builder = builderJobOf(ctx);
  const called: Entity[] = [];
  for (const id of DUG_IDS) {
    const surplus = Math.min(short, held.get(id) ?? 0);
    if (surplus <= 0) continue;
    const men = diggers
      .filter((man) => postOf(world, ctx, man, builder) === id && !busy(world, man))
      .sort((a, b) => b - a)
      .slice(0, surplus);
    called.push(...men);
    short -= men.length;
  }
  return called;
}

/** The posts of {@link POSTS} the men's number reaches that none holds, its builder posts sized to the
 *  colony's sites ({@link colonyBuilderWant}), handed to the free men and to the builders past their share,
 *  then the workshops' seats; once the store stands the rest dig, the least dug good first; a good a site
 *  needs and nobody digs goes first of all, as no ship brings what the land holds; a free man with no post
 *  to take builds, but a digger by a full store stays at his good. */
export function fillPosts(env: ColonyEnv, men: readonly Entity[], read: FoundingRead): PlayerCommand[] {
  const { world, ctx } = env;
  const builder = builderJobOf(ctx);
  const held = new Map<Post, number>();
  const builders: Entity[] = [];
  const free: Entity[] = [];
  // Diggers by a full store, free to move on: one no other post takes keeps digging rather than building, or
  // the store's room crossing its cap turns him builder and back on alternate decisions.
  const standing = new Set<Entity>();
  const posted = men.filter((man) => !atWorkshop(env, man));
  const digs = digGoodsWithRoom(env, read);
  const hunting = huntingOpen(
    env,
    read.store,
    posted,
    fishNear(env, read.origin) !== null || kitchenMouths(env, read.buildings) > 0,
  );
  for (const man of posted) {
    const post = postOf(world, ctx, man, builder);
    // A man at a full store's good moves on while another good wants digging, a hunter once no game is left.
    const moves =
      (isDug(post) && !digs.has(post) && digs.size > 0) ||
      (post === 'hunter' && !hunting && !busy(world, man));
    if (post === null || moves) free.push(man);
    else held.set(post, (held.get(post) ?? 0) + 1);
    if (moves && isDug(post)) standing.add(man);
    if (post === 'builder') builders.push(man);
  }
  const dug = new Map<DugGood, number>();
  for (const id of DUG_IDS) dug.set(id, held.get(id) ?? 0);
  const crew = colonyBuilderWant(world, ctx, read.buildings, read.plan.length);
  const listed = withBuilderPosts(
    withoutHunters(POSTS.slice(0, posted.length), hunting).filter((post) => !isDug(post) || digs.has(post)),
    'builder',
    crew,
  );
  // A dig past the store porter's round wants a porter of its own before any other post.
  const haulers = haulersBeyond(listed, farDigPorters(env, read.store));
  const table: Post[] = [...Array.from({ length: haulers }, (): Post => 'carrier'), ...listed];
  // What the next builds take and what the open sites still lack: a smithy site's iron, which no ship brings
  // past what home's stop holds, calls its digger while the site stands.
  const called = billsOf(env, read.plan);
  for (const [good, lacking] of sitesShortfalls(world, ctx, read.buildings))
    called.set(good, (called.get(good) ?? 0) + lacking);
  const urgent = DUG_IDS.filter((id) => {
    const good = goodTypeByContentId(ctx.content, id)?.typeId;
    return digs.has(id) && (dug.get(id) ?? 0) === 0 && good !== undefined && (called.get(good) ?? 0) > 0;
  });
  const open = [...urgent, ...table].filter((post) => {
    const standing = held.get(post) ?? 0;
    held.set(post, standing - 1);
    return standing <= 0;
  });
  // Men who built while their post could not take them yet, or past the sites' crew, go to work now.
  const past = builders.slice(0, Math.max(0, held.get('builder') ?? 0));
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
  // Only a colony with men past its table has diggers the dig loop placed there.
  if (posted.length > table.length) spare.push(...diggersForBuilders(env, open, spare.length, diggers, held));
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
  // Once the store stands the men past every post dig; before it they help raise it.
  const settled = read.store !== null && isBuilt(world, read.store);
  while (settled) {
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
      if (!standing.has(man) && world.get(man, Settler).jobType !== builder)
        commands.push({ kind: 'setJob', entity: man, jobType: builder });
  return commands;
}
