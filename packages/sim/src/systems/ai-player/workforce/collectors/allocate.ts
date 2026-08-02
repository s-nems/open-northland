import { Settler } from '../../../../components/index.js';
import type { Command } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood, liveWorkFlag } from '../../../economy/work-flag.js';
import { anchorNodeOf, nearestLiveResource } from '../../shared.js';
import {
  claimFlagNode,
  collectorSpot,
  flagSpotNear,
  patchAlive,
  type TakenFlagNodes,
} from '../flag-spots.js';
import type { SpareForce } from '../pool.js';
import { flagRelocateDue, upkeepHolders } from './upkeep.js';
import {
  COLLECTED_GOOD_IDS,
  GENERIC_COLLECTOR_TARGET,
  genericCollectorJob,
  goodByContentId,
  meetsNeed,
  needsVeteran,
  type WantedGood,
} from './wanted-goods.js';

/** The three commands posting `spare` as a flag gatherer of `w` at `spot`, recorded into the
 *  decision's `holders` list and `taken` nodes so later phases count the hire and keep off its spot
 *  before its commands apply. */
function postCollector(
  spare: Entity,
  w: WantedGood,
  spot: HalfCellNode,
  holders: Entity[],
  collectorsByGood: Map<number, Entity[]>,
  taken: TakenFlagNodes,
  commands: Command[],
): void {
  commands.push({ kind: 'setJob', entity: spare, jobType: w.job });
  commands.push({ kind: 'setWorkFlag', entity: spare, x: spot.hx, y: spot.hy });
  commands.push({ kind: 'setGatherGood', entity: spare, goodType: w.good.typeId });
  holders.push(spare);
  collectorsByGood.set(w.good.typeId, holders);
  claimFlagNode(taken, spot);
}

interface VeteranSteal {
  readonly veteran: Entity;
  readonly commands: readonly Command[];
  readonly vacatedGood: WantedGood;
}

/**
 * The veteran to move onto `w`'s empty post when no spare qualifies, or null. Were ungated goods to
 * steal from each other, a dry pool would have two of them trading the same man every decision, each
 * swap dropping his load and cancelling the dig. The good he leaves is rehired on a later decision.
 */
function stealVeteranFor(
  world: World,
  ctx: SystemContext,
  w: WantedGood,
  wanted: readonly WantedGood[],
  collectorsByGood: ReadonlyMap<number, Entity[]>,
  spot: HalfCellNode,
): VeteranSteal | null {
  for (const other of wanted) {
    if (other === w) continue;
    const otherHolders = collectorsByGood.get(other.good.typeId) ?? [];
    const veteran = otherHolders[0];
    if (veteran === undefined) continue;
    const { tribe, jobType } = world.get(veteran, Settler);
    if (!needsVeteran(ctx, tribe, w.good.typeId)) continue;
    if (needsVeteran(ctx, tribe, other.good.typeId)) continue;
    if (!meetsNeed(world, ctx, veteran, w.good.typeId)) continue;
    const commands: Command[] = [];
    if (jobType !== w.job) commands.push({ kind: 'setJob', entity: veteran, jobType: w.job });
    commands.push({ kind: 'setWorkFlag', entity: veteran, x: spot.hx, y: spot.hy });
    commands.push({ kind: 'setGatherGood', entity: veteran, goodType: w.good.typeId });
    return { veteran, commands, vacatedGood: other };
  }
  return null;
}

/**
 * First posts: keep at least one flag-bound gatherer per wanted good, each flag standing 2–3 tiles
 * from a live resource, over the upkeep of every current holder ({@link upkeepHolders}). No-op on a
 * mapless sim - no cells to place flags over. Source basis: user rules 2026-07-17 / -18 / -25.
 */
export function allocateCollectors(
  world: World,
  ctx: SystemContext,
  hq: Entity,
  wanted: readonly WantedGood[],
  collectorsByGood: Map<number, Entity[]>,
  force: SpareForce,
  taken: TakenFlagNodes,
  builderJob: number | null,
): Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const commands: Command[] = [];
  const relocateDue = flagRelocateDue(ctx);
  const hqNode = anchorNodeOf(world, hq);
  for (const w of wanted) {
    const holders = collectorsByGood.get(w.good.typeId) ?? [];
    upkeepHolders(world, ctx, terrain, w, holders, taken, relocateDue, builderJob, commands);
    if (holders.length > 0 || hqNode === null) continue;
    const spot = collectorSpot(world, ctx, terrain, hqNode, w.good.typeId, taken);
    if (spot === null) continue; // no reachable free spot beside a live node of this good
    const spare = force.take((e) => meetsNeed(world, ctx, e, w.good.typeId));
    if (spare !== null) {
      postCollector(spare, w, spot, holders, collectorsByGood, taken, commands);
      continue;
    }
    const steal = stealVeteranFor(world, ctx, w, wanted, collectorsByGood, spot);
    if (steal === null) continue;
    commands.push(...steal.commands);
    claimFlagNode(taken, spot);
    collectorsByGood.get(steal.vacatedGood.good.typeId)?.shift();
    holders.push(steal.veteran);
    collectorsByGood.set(w.good.typeId, holders);
  }
  return commands;
}

/**
 * Best-effort top-ups to each good's target - the ladder runs them after minimum staffing and the
 * builder reserve (user plan 2026-07-25: minimums everywhere beat second workers anywhere). Only
 * goods that already hold their first post (phase 1's concern) are topped up, and only from the
 * spare pool: moving a man off another good's post would leave that one short instead.
 */
export function topUpCollectors(
  world: World,
  ctx: SystemContext,
  hq: Entity,
  wanted: readonly WantedGood[],
  collectorsByGood: Map<number, Entity[]>,
  force: SpareForce,
  taken: TakenFlagNodes,
): Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const hqNode = anchorNodeOf(world, hq);
  if (hqNode === null) return [];
  const commands: Command[] = [];
  for (const w of wanted) {
    const holders = collectorsByGood.get(w.good.typeId) ?? [];
    while (holders.length > 0 && holders.length < w.target) {
      const spot = collectorSpot(world, ctx, terrain, hqNode, w.good.typeId, taken);
      if (spot === null) break;
      const spare = force.take((e) => meetsNeed(world, ctx, e, w.good.typeId));
      if (spare === null) break;
      postCollector(spare, w, spot, holders, collectorsByGood, taken, commands);
    }
  }
  return commands;
}

/**
 * Generic gatherers: up to {@link GENERIC_COLLECTOR_TARGET} collect-anything posts - a flag with NO good
 * filter (`setGatherGood null`), so the holder picks up whatever its trade may harvest inside the
 * circle (XP gates permitting). Hired at the lowest priority beside the collected-goods resource
 * nearest the HQ; retired to builder when nothing its trade harvests remains in the circle. No
 * relocation cadence - a generic flag either lives or retires (user plan 2026-07-25).
 */
export function allocateGenericCollectors(
  world: World,
  ctx: SystemContext,
  hq: Entity,
  genericCollectors: readonly Entity[],
  force: SpareForce,
  taken: TakenFlagNodes,
  builderJob: number | null,
): Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const commands: Command[] = [];
  for (const g of genericCollectors) {
    const flag = liveWorkFlag(world, g);
    const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (flag === undefined || flagNode === null) continue;
    const job = world.get(g, Settler).jobType;
    if (job === null) continue;
    if (patchAlive(world, flagNode, flag.radius, (r) => jobCanHarvestGood(ctx, job, r.goodType))) continue;
    if (builderJob !== null) commands.push({ kind: 'setJob', entity: g, jobType: builderJob });
  }
  const job = genericCollectorJob(ctx);
  const hqNode = anchorNodeOf(world, hq);
  if (job === null || hqNode === null) return commands;
  for (let hired = genericCollectors.length; hired < GENERIC_COLLECTOR_TARGET; hired++) {
    const resource = nearestCollectedResource(world, ctx, hqNode);
    if (resource === null) break; // no collected good stands anywhere - no generic post
    const spot = flagSpotNear(world, ctx, terrain, resource, taken);
    if (spot === null) break;
    const spare = force.take();
    if (spare === null) break;
    commands.push({ kind: 'setJob', entity: spare, jobType: job });
    commands.push({ kind: 'setWorkFlag', entity: spare, x: spot.hx, y: spot.hy });
    commands.push({ kind: 'setGatherGood', entity: spare, goodType: null });
    claimFlagNode(taken, spot);
  }
  return commands;
}

/** The anchor of the live {@link COLLECTED_GOOD_IDS} resource nearest the HQ - canonical
 *  `(distance, goodType)` pick, so two equidistant goods always resolve the same way. */
function nearestCollectedResource(
  world: World,
  ctx: SystemContext,
  hqNode: HalfCellNode,
): HalfCellNode | null {
  let best: { node: HalfCellNode; dist: number; goodType: number } | null = null;
  for (const goodId of COLLECTED_GOOD_IDS) {
    const good = goodByContentId(ctx.content, goodId);
    if (good === undefined) continue;
    const resource = nearestLiveResource(world, good.typeId, hqNode);
    if (resource === null) continue;
    const node = anchorNodeOf(world, resource);
    if (node === null) continue;
    const dist = Math.abs(node.hx - hqNode.hx) + Math.abs(node.hy - hqNode.hy);
    if (best === null || dist < best.dist || (dist === best.dist && good.typeId < best.goodType)) {
      best = { node, dist, goodType: good.typeId };
    }
  }
  return best?.node ?? null;
}
