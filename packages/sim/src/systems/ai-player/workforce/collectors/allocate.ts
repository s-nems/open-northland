import { Settler } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { SystemContext } from '../../../context.js';
import { jobCanHarvestGood, liveWorkFlag } from '../../../economy/work-flag.js';
import { goodTypeByContentId } from '../../content-lookup.js';
import { nearestLiveResource, type WorkableTest } from '../../live-resources.js';
import { anchorNodeOf } from '../../node-geometry.js';
import {
  claimFlagNode,
  collectorSpot,
  flagSpotNear,
  patchAlive,
  type TakenFlagNodes,
} from '../flag-spots.js';
import type { SpareForce } from '../pool.js';
import { type CollectorAnchors, type SeatedHolders, seatHolders } from './anchor.js';
import { flagRelocateDue, upkeepHolders } from './upkeep.js';
import {
  COLLECTED_GOOD_IDS,
  genericCollectorJob,
  meetsNeed,
  needsVeteran,
  type WantedGood,
} from './wanted-goods.js';

/** Post `spare` as a flag gatherer of `w` at `spot`, recorded into the decision's `holders` list and
 *  `taken` nodes so later phases count the hire and keep off its spot before its commands apply. */
function postCollector(
  spare: Entity,
  w: WantedGood,
  spot: HalfCellNode,
  holders: Entity[],
  collectorsByGood: Map<number, Entity[]>,
  taken: TakenFlagNodes,
  commands: PlayerCommand[],
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
  readonly commands: readonly PlayerCommand[];
  readonly vacatedGood: WantedGood;
}

/**
 * The veteran to move onto `w`'s empty post when no spare qualifies, or null. Only a gated good may
 * steal, and only from an ungated one: otherwise a dry pool would have two goods trading the same man
 * every decision, each swap dropping his load and cancelling the dig.
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
    const commands: PlayerCommand[] = [];
    if (jobType !== w.job) commands.push({ kind: 'setJob', entity: veteran, jobType: w.job });
    commands.push({ kind: 'setWorkFlag', entity: veteran, x: spot.hx, y: spot.hy });
    commands.push({ kind: 'setGatherGood', entity: veteran, goodType: w.good.typeId });
    return { veteran, commands, vacatedGood: other };
  }
  return null;
}

/** Where one decision's flag gatherers stand: each good's anchors, and which resources can still be
 *  worked. */
export interface CollectorGround {
  readonly anchors: CollectorAnchors;
  readonly baseNode: HalfCellNode;
  readonly workable: WorkableTest;
}

/** `w`'s holders seated on its anchors ({@link seatHolders}), with a free anchor for each post up to its
 *  target. */
function seatGood(
  world: World,
  ground: CollectorGround,
  w: WantedGood,
  holders: readonly Entity[],
): SeatedHolders {
  const slots = ground.anchors.slotsOf(w.good.id, Math.max(w.target, holders.length, 1));
  return seatHolders(world, holders, slots, ground.baseNode);
}

/**
 * First posts: keep at least one flag-bound gatherer per wanted good, and a short raw good's extra one
 * (`min`), each flag standing 2-3 tiles from a workable resource nearest its anchor (authored), over the
 * upkeep of every current holder ({@link upkeepHolders}). One post per good per decision. No-op on a
 * mapless sim, which has no cells to place flags over.
 */
export function allocateCollectors(
  world: World,
  ctx: SystemContext,
  ground: CollectorGround,
  wanted: readonly WantedGood[],
  collectorsByGood: Map<number, Entity[]>,
  force: SpareForce,
  taken: TakenFlagNodes,
  builderJob: number | null,
): PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const commands: PlayerCommand[] = [];
  const relocateDue = flagRelocateDue(ctx);
  const { workable } = ground;
  for (const w of wanted) {
    const holders = collectorsByGood.get(w.good.typeId) ?? [];
    const seated = seatGood(world, ground, w, holders);
    upkeepHolders(
      world,
      ctx,
      terrain,
      w,
      holders,
      seated.anchors,
      workable,
      taken,
      relocateDue,
      builderJob,
      commands,
    );
    const anchor = seated.free[0];
    if (holders.length >= w.min || anchor === undefined) continue;
    const spot = collectorSpot(world, ctx, terrain, anchor, w.good.typeId, taken, workable);
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
 * Best-effort top-ups to each good's target, run after minimum staffing and the builder reserve because
 * minimums everywhere beat second workers anywhere (authored). Only goods that already hold their first
 * post are topped up, and only from the spare pool: moving a man off another good's post would leave
 * that one short instead.
 */
export function topUpCollectors(
  world: World,
  ctx: SystemContext,
  ground: CollectorGround,
  wanted: readonly WantedGood[],
  collectorsByGood: Map<number, Entity[]>,
  force: SpareForce,
  taken: TakenFlagNodes,
): PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const commands: PlayerCommand[] = [];
  for (const w of wanted) {
    const holders = collectorsByGood.get(w.good.typeId) ?? [];
    if (holders.length === 0) continue;
    const { free } = seatGood(world, ground, w, holders);
    while (holders.length < w.target) {
      const anchor = free.shift();
      if (anchor === undefined) break;
      const spot = collectorSpot(world, ctx, terrain, anchor, w.good.typeId, taken, ground.workable);
      if (spot === null) break;
      const spare = force.take((e) => meetsNeed(world, ctx, e, w.good.typeId));
      if (spare === null) break;
      postCollector(spare, w, spot, holders, collectorsByGood, taken, commands);
    }
  }
  return commands;
}

/**
 * Generic gatherers: up to `target` collect-anything posts, a flag with no good filter, so the holder
 * picks up whatever its trade may harvest inside the circle. Hired beside the collected-good resource
 * nearest the base, so extra posts clear the ground a stalled placement needs. Once nothing workable its
 * trade harvests remains in the circle, the flag moves beside the next such resource, and the gatherer
 * retires to builder only when none is left (authored).
 */
export function allocateGenericCollectors(
  world: World,
  ctx: SystemContext,
  base: Entity,
  workable: WorkableTest,
  genericCollectors: readonly Entity[],
  force: SpareForce,
  taken: TakenFlagNodes,
  builderJob: number | null,
  target: number,
): PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const commands: PlayerCommand[] = [];
  const baseNode = anchorNodeOf(world, base);
  for (const g of genericCollectors) {
    const flag = liveWorkFlag(world, g);
    const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    if (flag === undefined || flagNode === null) continue;
    const job = world.get(g, Settler).jobType;
    if (job === null) continue;
    const harvests = (r: { goodType: number }): boolean => jobCanHarvestGood(ctx, job, r.goodType);
    if (patchAlive(world, flagNode, flag.radius, harvests, workable)) continue;
    const resource = baseNode === null ? null : nearestCollectedResource(world, ctx, baseNode, workable);
    const spot = resource === null ? null : flagSpotNear(world, ctx, terrain, resource, taken);
    if (spot !== null && (spot.hx !== flagNode.hx || spot.hy !== flagNode.hy)) {
      commands.push({ kind: 'setWorkFlag', entity: g, x: spot.hx, y: spot.hy });
      claimFlagNode(taken, spot);
    } else if (builderJob !== null) {
      commands.push({ kind: 'setJob', entity: g, jobType: builderJob });
    }
  }
  const job = genericCollectorJob(ctx);
  if (job === null || baseNode === null) return commands;
  for (let hired = genericCollectors.length; hired < target; hired++) {
    const resource = nearestCollectedResource(world, ctx, baseNode, workable);
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

/** The anchor of the workable live {@link COLLECTED_GOOD_IDS} resource nearest the base - canonical
 *  `(distance, goodType)` pick, so two equidistant goods always resolve the same way. */
function nearestCollectedResource(
  world: World,
  ctx: SystemContext,
  baseNode: HalfCellNode,
  workable: WorkableTest,
): HalfCellNode | null {
  let best: { node: HalfCellNode; dist: number; goodType: number } | null = null;
  for (const goodId of COLLECTED_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, goodId);
    if (good === undefined) continue;
    const resource = nearestLiveResource(world, good.typeId, baseNode, workable);
    if (resource === null) continue;
    const node = anchorNodeOf(world, resource);
    if (node === null) continue;
    const dist = Math.abs(node.hx - baseNode.hx) + Math.abs(node.hy - baseNode.hy);
    if (best === null || dist < best.dist || (dist === best.dist && good.typeId < best.goodType)) {
      best = { node, dist, goodType: good.typeId };
    }
  }
  return best?.node ?? null;
}
