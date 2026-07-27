import type { ContentSet } from '@open-northland/data';
import { Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { jobCanHarvestGood, liveWorkFlag } from '../../economy/flags.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { type BuildOrderEntry, collectorGoodsWanted, type EntryStatus } from '../build-order/index.js';
import { AI_DECISION_INTERVAL_TICKS, anchorNodeOf, nearestLiveResource } from '../shared.js';
import {
  claimFlagNode,
  collectorSpot,
  FLAG_MAX_DISTANCE_NODES,
  flagSpotNear,
  patchAlive,
  type TakenFlagNodes,
} from './flag-spots.js';
import type { SpareForce } from './pool.js';

/** The goods the gatherers collect from game start, by stable content id (user plan: clay, stone,
 *  wood). An id absent from the content set — or with no standing resource left on the map — is
 *  skipped. The build order adds its `collector` entries' goods (e.g. iron) once reached. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** How many flag gatherers the plan keeps per good, by stable content id (user plan 2026-07-25:
 *  wood/stone/iron run two, clay stays at {@link DEFAULT_COLLECTOR_TARGET}). The first post is
 *  phase-1 work (`allocateCollectors`); the rest are best-effort top-ups (`topUpCollectors`). */
export const COLLECTOR_TARGET_BY_GOOD_ID: Readonly<Record<string, number>> = {
  wood: 2,
  stone: 2,
  iron: 2,
};
export const DEFAULT_COLLECTOR_TARGET = 1;

/** How many collect-anything gatherers (a flag with no good filter) the seat keeps, at the lowest
 *  hiring priority (user plan 2026-07-25). */
export const GENERIC_COLLECTOR_TARGET = 2;

/** Every how many of a seat's decisions the collector flags are re-aimed at the nearest live
 *  resource — the infrequent "nudge the flags after the patch drifted" upkeep (user rule
 *  2026-07-18). 30 decisions ≈ 60 s at the base clock. */
export const FLAG_RELOCATE_EVERY_DECISIONS = 30;

/** A wanted collector good with its resolved gatherer trade, harvest atomic, and staffing target. */
export interface WantedGood {
  readonly good: ContentSet['goods'][number];
  readonly harvestAtomic: number;
  readonly job: number;
  readonly target: number;
}

/** The good definition with the given stable content id, or undefined. */
function goodByContentId(content: ContentSet, id: string) {
  return content.goods.find((g) => g.id === id);
}

/** The lowest gatherer trade whose grants include this harvest atomic, or null. */
function harvestJobFor(ctx: SystemContext, harvestAtomic: number): number | null {
  const index = contentIndex(ctx.content);
  let best: number | null = null;
  for (const job of index.harvestJobs) {
    if (!(index.atomicsByJob.get(job)?.has(harvestAtomic) ?? false)) continue;
    if (best === null || job < best) best = job;
  }
  return best;
}

/** The generalist gatherer trade: the harvest job that can flag-harvest the most goods, ties to the
 *  lowest typeId — a strict `(count desc, id asc)` order, so the winner never depends on set
 *  iteration order. Null when the content has no harvest trade. */
function genericCollectorJob(ctx: SystemContext): number | null {
  const index = contentIndex(ctx.content);
  let best: number | null = null;
  let bestCount = -1;
  for (const job of index.harvestJobs) {
    let count = 0;
    for (const good of ctx.content.goods) {
      if (jobCanHarvestGood(ctx, job, good.typeId)) count++;
    }
    if (count > bestCount || (count === bestCount && best !== null && job < best)) {
      best = job;
      bestCount = count;
    }
  }
  return best;
}

/** The wanted collector goods — the base set plus the build order's reached `collector` entries — in
 *  plan order, each with its gatherer trade and target resolved (`statuses` is the decision's
 *  {@link EntryStatus} snapshot). A good missing from the content set or with no harvest trade is
 *  skipped. */
export function wantedCollectorGoods(
  ctx: SystemContext,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
): WantedGood[] {
  const goodIds = [...COLLECTED_GOOD_IDS];
  for (const goodId of collectorGoodsWanted(order, statuses)) {
    if (!goodIds.includes(goodId)) goodIds.push(goodId);
  }
  const wanted: WantedGood[] = [];
  for (const goodId of goodIds) {
    const good = goodByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    const job = harvestJobFor(ctx, harvestAtomic);
    if (job === null) continue;
    const target = COLLECTOR_TARGET_BY_GOOD_ID[goodId] ?? DEFAULT_COLLECTOR_TARGET;
    wanted.push({ good, harvestAtomic, job, target });
  }
  return wanted;
}

/** Whether this settler's accrued XP clears the good's `needforgood` thresholds — the same gate the
 *  harvest pick applies (`nearestHarvestableFor`), so the allocator never posts a collector its own
 *  target scan would refuse (iron/gold demand clay/stone-track XP in the base data). */
function meetsNeed(world: World, ctx: SystemContext, e: Entity, goodType: number): boolean {
  return settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'good', goodType);
}

/** Whether ANY accrued-XP threshold gates the good for this tribe — a gated good needs a veteran, an
 *  ungated one accepts any fresh hire. */
function needGated(ctx: SystemContext, tribe: number, goodType: number): boolean {
  const tribeType = contentIndex(ctx.content).tribes.get(tribe);
  if (tribeType === undefined) return false;
  return tribeType.jobRequirements.some(
    (r) => r.requirement === 'need' && r.target === 'good' && r.targetId === goodType,
  );
}

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

/**
 * First posts: keep at least one flag-bound gatherer per wanted good, each flag standing 2–3 tiles
 * from a live resource, with the dry-patch and drift upkeep over every current holder. No-op on a
 * mapless sim — no cells to place flags over. Source basis: user rules 2026-07-17 / -18 / -25.
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

  // The infrequent flag upkeep: on every FLAG_RELOCATE_EVERY_DECISIONS-th decision, a flag whose nearest
  // live resource has drifted out of the 2–3-tile band is re-planted beside it — a live-but-receding
  // patch otherwise keeps the flag parked at its original spot.
  const relocateDue = Math.floor(ctx.tick / AI_DECISION_INTERVAL_TICKS) % FLAG_RELOCATE_EVERY_DECISIONS === 0;

  const hqNode = anchorNodeOf(world, hq);
  for (const w of wanted) {
    const holders = collectorsByGood.get(w.good.typeId) ?? [];
    for (const holder of holders) {
      const flag = liveWorkFlag(world, holder);
      const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
      if (flag === undefined || flagNode === null) continue; // vanished mid-decision — next pass rehires
      if (patchAlive(world, flagNode, flag.radius, (r) => r.goodType === w.good.typeId)) {
        if (!relocateDue) continue;
        const near = nearestLiveResource(world, w.good.typeId, flagNode);
        const nearNode = near === null ? null : anchorNodeOf(world, near);
        if (nearNode === null) continue;
        const drift = Math.abs(nearNode.hx - flagNode.hx) + Math.abs(nearNode.hy - flagNode.hy);
        if (drift <= FLAG_MAX_DISTANCE_NODES) continue; // still in the band — leave the flag be
        const spot = flagSpotNear(world, ctx, terrain, nearNode);
        if (spot !== null && (spot.hx !== flagNode.hx || spot.hy !== flagNode.hy)) {
          commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
        }
        continue;
      }
      const next = nearestLiveResource(world, w.good.typeId, flagNode);
      if (next === null) {
        // The map ran out of this good — the collector rejoins the builder pool.
        if (builderJob !== null) commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
        continue;
      }
      const node = anchorNodeOf(world, next);
      const spot = node === null ? null : flagSpotNear(world, ctx, terrain, node);
      if (spot !== null) commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
    }
    if (holders.length > 0 || hqNode === null) continue;
    const spot = collectorSpot(world, ctx, terrain, hqNode, w.good.typeId, taken);
    if (spot === null) continue; // nothing of this good on the map — no collector wanted
    const spare = force.take((e) => meetsNeed(world, ctx, e, w.good.typeId));
    if (spare !== null) {
      postCollector(spare, w, spot, holders, collectorsByGood, taken, commands);
      continue;
    }
    // No qualified spare. For an XP-gated good, re-post a veteran collector of an ungated good (a
    // clay/stone digger clears iron's threshold after one completed dig); its vacated good is rehired
    // from the pool on a later decision — the plan-order loop self-heals.
    for (const other of wanted) {
      if (other === w) continue;
      const otherHolders = collectorsByGood.get(other.good.typeId) ?? [];
      const veteran = otherHolders[0];
      if (veteran === undefined) continue;
      const s = world.get(veteran, Settler);
      if (needGated(ctx, s.tribe, other.good.typeId)) continue; // its own post needs a veteran too — keep it
      if (!meetsNeed(world, ctx, veteran, w.good.typeId)) continue;
      if (s.jobType !== w.job) commands.push({ kind: 'setJob', entity: veteran, jobType: w.job });
      commands.push({ kind: 'setWorkFlag', entity: veteran, x: spot.hx, y: spot.hy });
      commands.push({ kind: 'setGatherGood', entity: veteran, goodType: w.good.typeId });
      claimFlagNode(taken, spot);
      otherHolders.shift();
      holders.push(veteran);
      collectorsByGood.set(w.good.typeId, holders);
      break;
    }
  }
  return commands;
}

/**
 * Best-effort top-ups to each good's target — the ladder runs them after minimum staffing and the
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
 * Generic gatherers: up to {@link GENERIC_COLLECTOR_TARGET} collect-anything posts — a flag with NO good
 * filter (`setGatherGood null`), so the holder picks up whatever its trade may harvest inside the
 * circle (XP gates permitting). Hired at the lowest priority beside the collected-goods resource
 * nearest the HQ; retired to builder when nothing its trade harvests remains in the circle. No
 * relocation cadence — a generic flag either lives or retires (user plan 2026-07-25).
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
    if (resource === null) break; // no collected good stands anywhere — no generic post
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

/** The anchor of the live {@link COLLECTED_GOOD_IDS} resource nearest the HQ — canonical
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
