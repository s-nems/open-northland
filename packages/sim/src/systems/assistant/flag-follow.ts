import {
  AssistantMovesFlags,
  assistantMovesFlags,
  CurrentAtomic,
  HarvestFocus,
  ownerOf,
  ReplantMisses,
  Resource,
  Settler,
  WorkFlag,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import {
  type GathererReach,
  gathererReach,
  nearestLiveResourceOfGoods,
  reachableResourceTest,
  type WorkableTest,
  workableResourceTest,
} from '../ai-player/live-resources.js';
import { anchorNodeOf } from '../ai-player/node-geometry.js';
import { ownedBuildings } from '../ai-player/seat-roster.js';
import {
  claimFlagNode,
  type FlagBand,
  flagGround,
  nodeDistance,
  replantSpot,
  type TakenFlagNodes,
} from '../ai-player/workforce/flag-spots.js';
import type { System, SystemContext } from '../context.js';
import { jobGatherGoods, openGatherGoods } from '../economy/gather-goods.js';
import { jobCanHarvest, liveWorkFlag, relocateWorkFlag } from '../economy/work-flag.js';
import { needSubjectOf, settlerMeetsNeed } from '../progression/index.js';
import { isHunterJob } from '../readviews/index.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { interactionCell } from '../settlers/targets/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { anyResourceNear } from '../spatial/resources.js';

/**
 * The assistant's flag follow: with its owner's {@link AssistantMovesFlags} switch on, a flag gatherer's
 * flag is kept within {@link FOLLOW_FLAG_BAND} of a workable resource of his goods. The moved flag stands
 * on the side toward the owner's building nearest the old flag, so the yard lies between the work and the
 * settlement. A computer seat keeps the switch on and adds its own pull back toward its workshops. Source
 * basis: authored, the switch is this project's addition; the band is the owner's ruling.
 */

/** How far from his resource the follow keeps a gatherer's flag: 3-5 tiles, 6-10 half-cell nodes (owner's
 *  ruling), and any legal node within 5 tiles when that band is blocked. */
export const FOLLOW_FLAG_BAND: FlagBand = { min: 6, max: 10, fallbackMax: 10 };

/** How often one gatherer's flag is checked, in ticks (authored): a patch runs dry over minutes, not ticks.
 *  The flag gatherers are checked in ascending-id slices, one slice a tick, so no tick pays for them all. */
export const FLAG_FOLLOW_CHECK_PERIOD_TICKS = 4 * TICKS_PER_SECOND;

/** Every how many of his checks a gatherer searches for a new flag spot again after one found nothing, and
 *  one whose patch still feeds him may move his flag closer (authored): each search floods for flag spots.
 *  20 s at the base clock. */
export const REPLANT_RETRY_EVERY_CHECKS = 5;

export const flagFollowSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no cells to plant a flag on
  if (world.lowestEntityWith(AssistantMovesFlags) === null) return; // nobody has the switch on
  const holders = world.canonicalQuery(WorkFlag);
  const slice = ctx.tick % FLAG_FOLLOW_CHECK_PERIOD_TICKS;
  if (slice >= holders.length) return;
  const round = Math.floor(ctx.tick / FLAG_FOLLOW_CHECK_PERIOD_TICKS);
  const switchedOn = new Map<number, boolean>();
  let search: FollowSearch | null = null;
  // Ascending ids: a re-plant claims its spot against the later ones of the same slice.
  for (let i = slice; i < holders.length; i += FLAG_FOLLOW_CHECK_PERIOD_TICKS) {
    const e = holders[i];
    const owner = e === undefined ? undefined : ownerOf(world, e);
    if (e === undefined || owner === undefined) continue;
    let on = switchedOn.get(owner);
    if (on === undefined) {
      on = assistantMovesFlags(world, owner);
      switchedOn.set(owner, on);
    }
    if (!on) continue;
    search ??= followSearch(world, ctx, terrain);
    followFlag(world, ctx, terrain, e, round, search);
  }
};

/** One slice's shared search state: the reach and workable tests and the spots already handed out. */
interface FollowSearch {
  readonly reach: GathererReach;
  readonly workable: WorkableTest;
  readonly taken: TakenFlagNodes;
}

function followSearch(world: World, ctx: SystemContext, terrain: TerrainGraph): FollowSearch {
  return {
    reach: gathererReach(world, ctx, terrain),
    workable: workableResourceTest(world, ctx, terrain),
    taken: new Set(),
  };
}

/**
 * Check one gatherer's flag and move it after the resources once the nearest stands past the band or his
 * circle is worked out. A worked-out flag goes to the resource nearest the owner's building by the old
 * flag, so the work stays toward the settlement; one still fed moves only toward the resource nearest
 * it, and only on his retry phase, since he has work meanwhile. A hunter keeps his hunting ground and a
 * fisher his yard: neither works a standing resource.
 */
function followFlag(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  round: number,
  search: FollowSearch,
): void {
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobCanHarvest(ctx, jobType) || isHunterJob(ctx.content, jobType)) return;
  // Mid-action his patch reads as working, and a walk another system owns (an order, a flight, a wedding)
  // must not lose its route to a moved flag.
  if (world.has(e, CurrentAtomic) || anotherSystemOwns(world, e)) return;
  const flag = liveWorkFlag(world, e);
  const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
  if (flag === undefined || flagNode === null) return;
  const goods = followedGoods(world, ctx, e, jobType);
  if (goods.length === 0) return; // his counters stop every good he may dig: an idle patch is the player's call
  const { reach, taken } = search;
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  const flagCell = terrain.nodeAtClamped(flagNode.hx, flagNode.hy);
  const reachable = reachableResourceTest(world, ctx, terrain, flagNode, search.workable);
  const workable: WorkableTest =
    limit === null
      ? reachable
      : (r) => reachable(r) && limit.allowsNode(interactionCell(world, ctx, terrain, r, flagCell));
  const witness = reach.patchWitness(e, flagNode, flag.radius, (g) => goods.includes(g));
  const fed = witness !== null;
  if (fed) {
    // The witness is a cache hint, so it may only save the band query, never change its answer: it counts
    // only when it passes that query's own test.
    if (
      inBand(world, witness, goods, flagNode, workable) ||
      resourceInBand(world, goods, flagNode, workable)
    ) {
      forgetReplantMisses(world, e);
      return;
    }
    if ((round + e) % REPLANT_RETRY_EVERY_CHECKS !== 0) return;
  } else if (!replantDue(world, e, flagNode, round)) return;
  const origin = settlementSide(world, e, flagNode);
  const from = fed ? flagNode : origin;
  const nearest = (untried: WorkableTest): Entity | null =>
    nearestLiveResourceOfGoods(world, goods, from, (r) => workable(r) && untried(r));
  const ground = flagGround(world, ctx, terrain, limit);
  const replant = replantSpot(world, ground, e, flag.radius, nearest, origin, reach, taken, FOLLOW_FLAG_BAND);
  if (replant === 'dry' || replant === null) {
    // A fed gatherer's miss says nothing about his post: only a worked-out one counts toward retiring it.
    if (!fed) replantMissed(world, e, flagNode);
    return;
  }
  const { spot } = replant;
  forgetReplantMisses(world, e);
  claimFlagNode(taken, spot);
  // As a moved flag does: the node being approached may lie outside the new circle.
  if (world.has(e, HarvestFocus)) world.remove(e, HarvestFocus);
  relocateWorkFlag(world, flag.flag, positionOfNode(spot.hx, spot.hy), e);
  wakeIdle(world, e); // a worked-out gatherer idles: he plans from the new flag this tick
}

/** Whether a live resource of `goods` that `workable` accepts stands within the band of `flagNode`: one
 *  bounded box query, so a gatherer whose flag already stands by his work pays no wider search. */
function resourceInBand(
  world: World,
  goods: readonly number[],
  flagNode: HalfCellNode,
  workable: WorkableTest,
): boolean {
  return anyResourceNear(world, flagNode.hx, flagNode.hy, FOLLOW_FLAG_BAND.max, (r) =>
    inBand(world, r, goods, flagNode, workable),
  );
}

/** Whether `r` is a live resource of `goods` within the band of `flagNode` that `workable` accepts. */
function inBand(
  world: World,
  r: Entity,
  goods: readonly number[],
  flagNode: HalfCellNode,
  workable: WorkableTest,
): boolean {
  const res = world.get(r, Resource);
  if (res.remaining <= 0 || !goods.includes(res.goodType)) return false;
  const at = anchorNodeOf(world, r);
  return at !== null && nodeDistance(at, flagNode) <= FOLLOW_FLAG_BAND.max && workable(r);
}

/** The anchor of the owner's building nearest `flagNode`, HQ, store or any other, which the new flag faces
 *  so the carriers' walk to it stays short; the old flag when the owner has none. Ties to the lower id. */
function settlementSide(world: World, e: Entity, flagNode: HalfCellNode): HalfCellNode {
  const owner = ownerOf(world, e);
  if (owner === undefined) return flagNode;
  let best = flagNode;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const b of ownedBuildings(world, owner)) {
    const at = anchorNodeOf(world, b);
    if (at === null) continue;
    const distance = nodeDistance(at, flagNode);
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    }
  }
  return best;
}

/** The goods his flag follows: those his counters leave open and his experience lets him dig, so the
 *  re-plant's few attempts never go to a deposit he would turn down. */
function followedGoods(world: World, ctx: SystemContext, e: Entity, jobType: number): number[] {
  const open = openGatherGoods(world, ctx, e, jobType);
  const subject = needSubjectOf(world, e);
  return (open === undefined ? jobGatherGoods(ctx, jobType) : [...open]).filter((g) =>
    settlerMeetsNeed(world, ctx, subject, 'good', g),
  );
}

/** Whether a worked-out gatherer searches for a re-plant on this check: at once when no search from his
 *  flag has missed yet, then on his phase of every {@link REPLANT_RETRY_EVERY_CHECKS}. */
function replantDue(world: World, e: Entity, flagNode: HalfCellNode, round: number): boolean {
  if (replantMissesAt(world, e, flagNode) === 0) return true;
  return (round + e) % REPLANT_RETRY_EVERY_CHECKS === 0;
}

/** How many re-plant searches from `flagNode` in a row found nothing for `e`. */
export function replantMissesAt(world: World, e: Entity, flagNode: HalfCellNode): number {
  const record = world.tryGet(e, ReplantMisses);
  return record !== undefined && record.hx === flagNode.hx && record.hy === flagNode.hy ? record.misses : 0;
}

function replantMissed(world: World, e: Entity, flagNode: HalfCellNode): void {
  const misses = replantMissesAt(world, e, flagNode) + 1;
  if (world.has(e, ReplantMisses)) {
    const live = world.mut(e, ReplantMisses);
    live.hx = flagNode.hx;
    live.hy = flagNode.hy;
    live.misses = misses;
  } else {
    world.add(e, ReplantMisses, { hx: flagNode.hx, hy: flagNode.hy, misses });
  }
}

export function forgetReplantMisses(world: World, e: Entity): void {
  if (world.has(e, ReplantMisses)) world.remove(e, ReplantMisses);
}
