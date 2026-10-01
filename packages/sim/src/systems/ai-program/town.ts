import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  Damaged,
  Female,
  JobAssignment,
  ownerOf,
  Residence,
  Settler,
  SettlerProgress,
  SiteAssignment,
  Stockpile,
  setStockAmount,
  UnderConstruction,
  Wedding,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { nearestRaiderWithin, type Raider } from '../ai-player/military/defence/threat.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../ai-player/seat-roster.js';
import { builderJobOf, classifyWorkforce } from '../ai-player/workforce/pool.js';
import type { SystemContext } from '../context.js';
import { openWorkerJobFromList } from '../economy/jobs/openings.js';
import { needsRepair, repairCrewLimit } from '../economy/repair.js';
import { liveWorkFlag } from '../economy/work-flag.js';
import { isAdultSettler } from '../family/eligibility.js';
import { familiesOf } from '../family/households.js';
import { isFighterJob, isFisherJob } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import { type NavigationLimit, navigationLimitFor } from '../signposts/index.js';
import { entityNode } from '../spatial/nodes.js';
import { assignedWorkers } from '../stores/assigned-workers.js';
import { isCarrierJob } from '../stores/index.js';
import { mergedRecipeOf, recipeConsumes } from '../stores/workplace.js';
import { AI_STOCK_REFILL_LEVEL } from '../trade/partner-stock.js';

/** How close an enemy fighter keeps the handler from staffing, housing or mending a building, in map
 *  points. Original behavior (it also counts enemy vehicles, which this build leaves out). */
export const TOWN_ENEMY_NEAR_POINTS = 40;
/** How far the handler looks for a man to take a post or a woman to take a home. Original behavior. */
export const TOWN_HIRE_RADIUS_POINTS = 80;
/** How far it looks for a man to turn builder. Original behavior. */
export const TOWN_BUILDER_RADIUS_POINTS = 400;
/** Builders the handler sends to mend one damaged building a pass, a wall's own crew limit below it.
 *  Original behavior. */
export const TOWN_REPAIR_BUILDERS = 2;
/** The town pass leaves a workshop's product slot filled to its capacity over this, so its carrier still
 *  has goods to walk to the store. */
const KEPT_PRODUCT_DIVISOR = 2;

/** A building of the seat with the node it is reached at. */
interface Placed {
  readonly entity: Entity;
  readonly node: NodeId;
  readonly x: number;
  readonly y: number;
  readonly component: number;
}

/** A person of the seat where it stands, and the signposts' bounds on where it may be sent. */
interface PlacedPerson extends Placed {
  readonly limit: NavigationLimit | null;
}

/**
 * The scripted handler's town pass (original behavior): builders for every site and damaged building of
 * the seat, one man for each civilian trade a standing building employs nobody in, and a home for every
 * woman without one. A building with an enemy fighter near it is left alone. The gatherers' and fishers'
 * slots stay open, an approximation: the original posts them at their house, while one without a flag
 * here roams to the nearest resource or water of his trade, which can lie in a rival's land.
 */
export function townStaffingOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  raiders: readonly Raider[],
  { staff, house }: { readonly staff: boolean; readonly house: boolean },
): PlayerCommand[] {
  const safe = (at: Placed): boolean =>
    nearestRaiderWithin(raiders, at.x, at.y, TOWN_ENEMY_NEAR_POINTS, null) === null;
  const commands: PlayerCommand[] = [];
  if (staff) {
    // Craftsmen take their own trades before the builders are drawn, so a site never retrains the baker
    // a bakery is waiting for; the other posts take whoever is left after the builders.
    const skilled = skilledTrades(ctx);
    const men = spareMen(world, ctx, terrain, seat);
    const posts = openPosts(world, ctx, terrain, seat, safe);
    commands.push(...postOrders(world, ctx, skilled, men, posts, true));
    commands.push(...builderOrders(world, ctx, terrain, seat, skilled, men, safe));
    commands.push(...postOrders(world, ctx, skilled, men, posts, false));
  }
  if (house) commands.push(...homeOrders(world, ctx, terrain, seat, safe));
  return commands;
}

/**
 * Hold the seat's goods so its town keeps working whatever it makes. Every slot of a standing store is
 * levelled at {@link AI_STOCK_REFILL_LEVEL}, a fuller one cut down too (original behavior), so a store
 * neither runs dry nor fills up. A standing workshop's recipe inputs are filled to capacity and its
 * products cut to half their slot, so its craftsman never waits on a haul and never stops on a full
 * shelf, while its carrier still has goods to walk to the store; the original holds the stores alone,
 * and its workshops run on what the carriers bring.
 */
export function holdTownGoods(world: World, ctx: SystemContext, seat: number): void {
  const index = contentIndex(ctx.content);
  for (const e of ownedBuildings(world, seat)) {
    if (!isBuilt(world, e) || !world.has(e, Stockpile)) continue;
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type === undefined) continue;
    if (type.kind === BUILDING_KIND.storage) {
      for (const slot of type.stock) {
        setStockAmount(world, e, slot.goodType, Math.min(slot.capacity, AI_STOCK_REFILL_LEVEL));
      }
      continue;
    }
    const recipe = mergedRecipeOf(world, ctx, e);
    if (recipe === undefined) continue;
    const amounts = world.get(e, Stockpile).amounts;
    for (const slot of type.stock) {
      if (recipeConsumes(recipe.inputs, slot.goodType)) {
        setStockAmount(world, e, slot.goodType, slot.capacity);
      } else if (recipe.outputs.some((out) => out.goodType === slot.goodType)) {
        const kept = Math.trunc(slot.capacity / KEPT_PRODUCT_DIVISOR);
        if ((amounts.get(slot.goodType) ?? 0) > kept) setStockAmount(world, e, slot.goodType, kept);
      }
    }
  }
}

/** The seat's men free to take a post or turn builder, in canonical order. */
function spareMen(world: World, ctx: SystemContext, terrain: TerrainGraph, seat: number): PlacedPerson[] {
  const men: PlacedPerson[] = [];
  for (const e of classifyWorkforce(world, ctx, seat, []).pool) {
    // A gatherer at his live flag is working already.
    if (world.has(e, SiteAssignment) || world.has(e, Wedding) || liveWorkFlag(world, e) !== undefined)
      continue;
    men.push(placedPerson(world, ctx, terrain, e));
  }
  return men;
}

/** Turn the nearest spare men builders until the sites and repairs have their crews; the builders find
 *  their sites themselves. A workshop's vehicle yard is its own crew's work and wants no builder. */
function builderOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  skilled: ReadonlySet<number>,
  men: PlacedPerson[],
  safe: (at: Placed) => boolean,
): PlayerCommand[] {
  const builderJob = builderJobOf(ctx);
  if (builderJob === null) return [];
  const index = contentIndex(ctx.content);
  const sites: { at: Placed; crew: number }[] = [];
  const consider = (e: Entity, crew: number): void => {
    const at = placedBuilding(world, ctx, terrain, e);
    if (safe(at)) sites.push({ at, crew });
  };
  for (const e of ownedBuildings(world, seat)) {
    const kind = index.buildings.get(world.get(e, Building).buildingType)?.kind;
    if (world.has(e, UnderConstruction) && kind !== BUILDING_KIND.vehicle)
      consider(e, repairCrewLimit(world, e));
  }
  // Damaged walls carry no Building, so the repairs come from the damage index.
  for (const e of world.query(Damaged)) {
    if (ownerOf(world, e) !== seat || world.has(e, UnderConstruction) || !needsRepair(world, e)) continue;
    consider(e, Math.min(repairCrewLimit(world, e), TOWN_REPAIR_BUILDERS));
  }
  if (sites.length === 0) return [];
  let idle = 0;
  for (const e of ownedSettlers(world, seat)) {
    if (world.get(e, Settler).jobType === builderJob && !world.has(e, JobAssignment)) idle++;
  }
  const commands: PlayerCommand[] = [];
  const isBuilder = (e: Entity): boolean => world.get(e, Settler).jobType === builderJob;
  for (const site of sites) {
    let missing = site.crew;
    // A builder counted for this site stays out of the posts below; one already on a site is not spare.
    for (; missing > 0 && idle > 0; missing--, idle--) {
      takeBest(men, site.at, Number.POSITIVE_INFINITY, (e) => (isBuilder(e) ? 0 : null));
    }
    for (; missing > 0; missing--) {
      const man = takeBest(men, site.at, TOWN_BUILDER_RADIUS_POINTS, (e) =>
        isBuilder(e) ? null : hireRank(world, skilled, builderJob, e, builderJob),
      );
      if (man === null) break;
      commands.push({ kind: 'setJob', entity: man, jobType: builderJob });
    }
  }
  return commands;
}

/**
 * One man for each open civilian post, the nearest by {@link hireRank}; with `sameTradeOnly` only the men
 * already in the post's trade, over every building, so an early building's transport post does not
 * retrain the craftsman a later workshop is waiting for. A filled post leaves `posts`.
 */
function postOrders(
  world: World,
  ctx: SystemContext,
  skilled: ReadonlySet<number>,
  men: PlacedPerson[],
  posts: OpenPost[],
  sameTradeOnly: boolean,
): PlayerCommand[] {
  const builderJob = builderJobOf(ctx);
  const commands: PlayerCommand[] = [];
  for (let i = 0; i < posts.length && men.length > 0; ) {
    const post = posts[i];
    if (post === undefined) break;
    const man = takeBest(men, post.at, TOWN_HIRE_RADIUS_POINTS, (e) => {
      if (!takesPost(world, ctx, e, post.at.entity, post.jobType)) return null;
      const rank = hireRank(world, skilled, builderJob, e, post.jobType);
      return sameTradeOnly && rank !== HIRE_RANK.sameTrade ? null : rank;
    });
    if (man === null) {
      i++;
      continue;
    }
    commands.push({
      kind: 'assignWorker',
      entity: man,
      building: post.at.entity,
      jobPriority: [post.jobType],
    });
    posts.splice(i, 1);
  }
  return commands;
}

/** A civilian post nobody holds: the building, reached at its door, and the trade. */
interface OpenPost {
  readonly at: Placed;
  readonly jobType: number;
}

/** The civilian posts nobody holds at the seat's standing buildings with no enemy near, in canonical
 *  building order. */
function openPosts(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  safe: (at: Placed) => boolean,
): OpenPost[] {
  const index = contentIndex(ctx.content);
  const open: OpenPost[] = [];
  for (const building of ownedBuildings(world, seat)) {
    if (!isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined || type.kind === BUILDING_KIND.home || type.kind === BUILDING_KIND.tower) continue;
    const held = new Set<number | null>();
    for (const e of assignedWorkers(world, building)) held.add(world.tryGet(e, Settler)?.jobType ?? null);
    const trades = type.workers.filter(
      (slot) =>
        !held.has(slot.jobType) &&
        !isFighterJob(ctx.content, slot.jobType) &&
        !index.harvestJobs.has(slot.jobType) &&
        !isFisherJob(ctx.content, slot.jobType),
    );
    if (trades.length === 0) continue;
    const at = placedBuilding(world, ctx, terrain, building);
    if (!safe(at)) continue;
    for (const slot of trades) open.push({ at, jobType: slot.jobType });
  }
  return open;
}

/**
 * Who takes a post first: a man already in its trade, then a man with no craft, then a builder, then a
 * craftsman of another trade. The original takes the nearest man whatever his trade; this keeps a map's
 * authored craftsmen at their crafts and its builders at the sites.
 */
function hireRank(
  world: World,
  skilled: ReadonlySet<number>,
  builderJob: number | null,
  e: Entity,
  jobType: number,
): number {
  const job = world.get(e, Settler).jobType;
  if (job === jobType) return HIRE_RANK.sameTrade;
  if (job === builderJob) return HIRE_RANK.builder;
  return job !== null && skilled.has(job) ? HIRE_RANK.otherCraft : HIRE_RANK.untrained;
}

const HIRE_RANK = { sameTrade: 0, untrained: 1, builder: 2, otherCraft: 3 } as const;

/** The trades a building posts other than transport: a man holding one has learned a craft. */
function skilledTrades(ctx: SystemContext): Set<number> {
  const trades = new Set<number>();
  for (const type of contentIndex(ctx.content).buildings.values()) {
    for (const slot of type.workers) if (!isCarrierJob(ctx, slot.jobType)) trades.add(slot.jobType);
  }
  return trades;
}

/** Whether `assignWorker` would give `e` the `jobType` post at `building`, past the signpost bound
 *  {@link takeBest} already applied. */
function takesPost(world: World, ctx: SystemContext, e: Entity, building: Entity, jobType: number): boolean {
  const settler = world.get(e, Settler);
  const progress = world.get(e, SettlerProgress);
  const query = {
    world,
    ctx,
    tribe: settler.tribe,
    owner: ownerOf(world, e),
    experience: progress.experience,
    learned: progress.learned,
    jobType: settler.jobType,
  };
  return openWorkerJobFromList(query, building, [jobType]) === jobType;
}

/** Move the nearest homeless women, each with her family, into the standing homes with a free family
 *  slot. */
function homeOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  safe: (at: Placed) => boolean,
): PlayerCommand[] {
  const index = contentIndex(ctx.content);
  const women: PlacedPerson[] = [];
  for (const e of ownedSettlers(world, seat)) {
    if (!world.has(e, Female) || !isAdultSettler(world, e) || world.has(e, Residence)) continue;
    if (isFighterJob(ctx.content, world.get(e, Settler).jobType)) continue;
    women.push(placedPerson(world, ctx, terrain, e));
  }
  const commands: PlayerCommand[] = [];
  for (const house of ownedBuildings(world, seat)) {
    if (women.length === 0) break;
    if (!isBuilt(world, house)) continue;
    const type = index.buildings.get(world.get(house, Building).buildingType);
    if (type?.kind !== BUILDING_KIND.home) continue;
    const at = placedBuilding(world, ctx, terrain, house);
    if (!safe(at)) continue;
    for (let free = type.homeSize - familiesOf(world, house).length; free > 0; free--) {
      const tribe = world.get(house, Building).tribe;
      const woman = takeBest(women, at, TOWN_HIRE_RADIUS_POINTS, (e) =>
        world.get(e, Settler).tribe === tribe ? 0 : null,
      );
      if (woman === null) break;
      commands.push({ kind: 'assignHouse', entity: woman, house });
    }
  }
  return commands;
}

/** A candidate's standing for a pick, lower first, or null when he does not qualify. */
type Rank = (e: Entity) => number | null;

/** Remove and return the person of `people` on `at`'s ground within `radius` of best rank, the nearest
 *  among those and the first in canonical order on a tie, or null. A person whose signposts keep him
 *  from `at` never qualifies, since the order would leave him standing lost. */
function takeBest(people: PlacedPerson[], at: Placed, radius: number, rank: Rank): Entity | null {
  let best = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [i, person] of people.entries()) {
    if (person.component !== at.component) continue;
    const distance = hexDistanceBetween(person.x, person.y, at.x, at.y);
    if (distance > radius) continue;
    if (person.limit !== null && !person.limit.allowsNode(at.node)) continue;
    const standing = rank(person.entity);
    if (standing === null || standing > bestRank || (standing === bestRank && distance >= bestDistance))
      continue;
    best = i;
    bestRank = standing;
    bestDistance = distance;
  }
  if (best < 0) return null;
  const [taken] = people.splice(best, 1);
  return taken?.entity ?? null;
}

function placedPerson(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): PlacedPerson {
  const node = entityNode(world, terrain, e);
  return {
    entity: e,
    node,
    ...terrain.coordsOf(node),
    component: terrain.componentOf(node),
    limit: navigationLimitFor(world, ctx.content, terrain, e),
  };
}

function placedBuilding(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): Placed {
  const door = interactionCell(world, ctx, terrain, e);
  return { entity: e, node: door, ...terrain.coordsOf(door), component: terrain.componentOf(door) };
}
