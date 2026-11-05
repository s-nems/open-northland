import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { Building, DEFAULT_WORK_FLAG_RADIUS, Settler } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { jobGatherGoods } from '../../../economy/gather-goods.js';
import { WORKPLACE_COLLECT_RADIUS } from '../../../economy/haul-flag.js';
import { jobUsesWorkFlag, liveHaulFlag, liveWorkFlag } from '../../../economy/work-flag.js';
import { interactionNodeId } from '../../../footprint/interaction.js';
import { heldBands } from '../../../settlers/targets/held-bands.js';
import { landReachAt, networkLimitAt } from '../../../signposts/index.js';
import { assignedWorkers } from '../../../stores/assigned-workers.js';
import { isYardHeap } from '../../../stores/index.js';
import { isCarrierJob } from '../../../stores/workplace.js';
import type { ColonyEnv } from '../env.js';
import { colonists } from '../roster.js';

// A colony's gatherers set what they dig down by their flags, and the store's porters take it in: one
// porter keeps the store's own round, and one more holds a flag at each dig past that round (our own
// choice for the computer player, through the player's flag order). The colony's stock policy counts only
// what its stores hold and the heaps in their reach, so a heap no porter brings in reads as missing.

/** How far inside a porter's reach a dig must lie, in Manhattan nodes (authored): a gatherer's heaps spread
 *  up to about nine nodes off its flag on the real map, and the flag order snaps a porter's flag a few nodes
 *  off the spot asked. */
const DIG_SLACK_NODES = 8;

/** The colony's first store while it stands: the building, its node and its door. */
interface StandingStore {
  readonly e: Entity;
  readonly at: HalfCellNode;
  readonly door: NodeId;
}

/** {@link farDigs} per colony decision: a decision asks it for its posts, its ferry and its porters. */
const digsByDecision = new WeakMap<ColonyEnv, { readonly store: Entity; readonly digs: HalfCellNode[] }>();

/**
 * The digs past the store porter's round: the flags of the colony's gatherers and fishers, ascending by
 * flag, then the heaps of what they gather on its land and inside its signposts, ascending, a dig's flag
 * moved on from among them. The heaps are read off the holding bands within the signposts' box, so a heap
 * no fetcher reaches stays out and the walk is bounded by the colony, not the map.
 */
function farDigs(env: ColonyEnv, store: StandingStore): HalfCellNode[] {
  const held = digsByDecision.get(env);
  if (held !== undefined && held.store === store.e) return held.digs;
  const { world, ctx, terrain, seat } = env;
  const home = store.at;
  const flags: { readonly flag: Entity; readonly at: HalfCellNode }[] = [];
  for (const e of colonists(env)) {
    const live = liveWorkFlag(world, e);
    const at = live === undefined ? null : anchorNodeOf(world, live.flag);
    if (live === undefined || at === null) continue;
    if (nodeManhattan(at, home) > WORKPLACE_COLLECT_RADIUS - DIG_SLACK_NODES)
      flags.push({ flag: live.flag, at });
  }
  const digs = flags.sort((a, b) => a.flag - b.flag).map((f) => f.at);
  const reach = networkLimitAt(world, terrain, seat, home.hx, home.hy) ?? landReachAt(terrain, store.door);
  const heaps = new Map<Entity, HalfCellNode>();
  const bands = heldBands(world, ctx, terrain);
  for (const good of yardGoods(ctx)) {
    const band = bands.holding(good);
    band.sync();
    band.index.forEachLooseIn(reach.bounds, (pile, hx, hy) => {
      if (heaps.has(pile) || !isYardHeap(world, pile)) return;
      const node = terrain.nodeAt(hx, hy);
      const at = { hx, hy };
      if (
        terrain.componentOf(node) !== env.colony.land ||
        nodeManhattan(at, home) <= WORKPLACE_COLLECT_RADIUS
      )
        return;
      if (reach.allowsNode(node)) heaps.set(pile, at);
    });
  }
  for (const pile of [...heaps.keys()].sort((a, b) => a - b)) {
    const at = heaps.get(pile);
    if (at !== undefined) digs.push(at);
  }
  digsByDecision.set(env, { store: store.e, digs });
  return digs;
}

const yardGoodsByContent = new WeakMap<ContentSet, readonly number[]>();

/** Every good a field gatherer or fisher sets down by its flag, ascending: what a colony's heaps hold. */
function yardGoods(ctx: SystemContext): readonly number[] {
  let goods = yardGoodsByContent.get(ctx.content);
  if (goods === undefined) {
    const found = new Set<number>();
    for (const job of ctx.content.jobs) {
      if (!jobUsesWorkFlag(ctx, job.typeId)) continue;
      for (const good of jobGatherGoods(ctx, job.typeId)) found.add(good);
    }
    goods = [...found].sort((a, b) => a - b);
    yardGoodsByContent.set(ctx.content, goods);
  }
  return goods;
}

/** Whether a porter's flag of `radius` at `at` takes in the dig at `dig`. */
function covers(at: HalfCellNode, radius: number, dig: HalfCellNode): boolean {
  return nodeManhattan(at, dig) <= radius - DIG_SLACK_NODES;
}

/**
 * Where porters' flags take in `digs`: each the dig taking in most of those left, the nearest `home` on a
 * tie and then the first, until every dig is taken in.
 */
function digCentres(digs: readonly HalfCellNode[], home: HalfCellNode): HalfCellNode[] {
  const centres: HalfCellNode[] = [];
  let open = [...digs];
  while (open.length > 0) {
    let best: { readonly at: HalfCellNode; readonly takes: number; readonly distance: number } | null = null;
    for (const at of open) {
      const takes = open.filter((dig) => covers(at, DEFAULT_WORK_FLAG_RADIUS, dig)).length;
      const distance = nodeManhattan(at, home);
      if (best === null || takes > best.takes || (takes === best.takes && distance < best.distance))
        best = { at, takes, distance };
    }
    if (best === null) break;
    const centre = best.at;
    centres.push(centre);
    open = open.filter((dig) => !covers(centre, DEFAULT_WORK_FLAG_RADIUS, dig));
  }
  return centres;
}

/** The colony's first store while it stands. */
function standingStore(env: ColonyEnv, store: Entity | null): StandingStore | null {
  if (store === null || !isBuilt(env.world, store)) return null;
  const at = anchorNodeOf(env.world, store);
  const door = interactionNodeId(env.world, env.ctx, env.terrain, store);
  return at === null || door === null ? null : { e: store, at, door };
}

/** The carrier seats `store` offers. */
function carrierSeats(env: ColonyEnv, store: Entity): number {
  const { world, ctx } = env;
  const type = contentIndex(ctx.content).buildings.get(world.get(store, Building).buildingType);
  if (type?.kind !== BUILDING_KIND.storage) return 0;
  return type.workers.find((slot) => isCarrierJob(ctx, slot.jobType))?.count ?? 0;
}

/** The porters the digs past the colony's first store's round want beside the one keeping it: one a dig,
 *  as many as the store's seats leave; none while it does not stand. */
export function farDigPorters(env: ColonyEnv, store: Entity | null): number {
  const standing = standingStore(env, store);
  if (standing === null) return 0;
  const far = digCentres(farDigs(env, standing), standing.at);
  return Math.max(0, Math.min(carrierSeats(env, standing.e) - 1, far.length));
}

/**
 * The flag orders for the porters of the colony's first store. The lowest porter without a flag keeps the
 * store's round, and so does the lowest one with a flag when every porter holds one: his flag goes. A
 * flag that still takes in a dig past the round stays; every other porter takes his flag to the next dig
 * none takes in ({@link digCentres}), or gives it up when none is left. Orders go out only for a change.
 */
export function porterFlagOrders(env: ColonyEnv, store: Entity | null): PlayerCommand[] {
  const { world, ctx } = env;
  const standing = standingStore(env, store);
  if (standing === null) return [];
  const porters = assignedWorkers(world, standing.e).filter((e) => {
    const job = world.get(e, Settler).jobType;
    return job !== null && isCarrierJob(ctx, job);
  });
  const keeper = porters.find((e) => liveHaulFlag(world, e) === undefined) ?? porters[0];
  if (keeper === undefined) return [];
  const commands: PlayerCommand[] =
    liveHaulFlag(world, keeper) === undefined ? [] : [{ kind: 'clearHaulFlag', entity: keeper }];
  let open = farDigs(env, standing);
  const spare: Entity[] = [];
  for (const porter of porters) {
    if (porter === keeper) continue;
    const live = liveHaulFlag(world, porter);
    const at = live === undefined ? null : anchorNodeOf(world, live.flag);
    if (live === undefined || at === null || !open.some((dig) => covers(at, live.radius, dig))) {
      spare.push(porter);
      continue;
    }
    open = open.filter((dig) => !covers(at, live.radius, dig));
  }
  const centres = digCentres(open, standing.at);
  for (const porter of spare) {
    const centre = centres.shift();
    if (centre !== undefined)
      commands.push({ kind: 'setWorkFlag', entity: porter, x: centre.hx, y: centre.hy });
    else if (liveHaulFlag(world, porter) !== undefined)
      commands.push({ kind: 'clearHaulFlag', entity: porter });
  }
  return commands;
}
