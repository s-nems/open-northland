import type { ContentSet } from '@open-northland/data';
import {
  Building,
  ErectSignpostOrder,
  Female,
  JobAssignment,
  PlayerOrder,
  Resource,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { nodeBoxOfCircles, withinNodeRadius } from '../../nav/node-metric.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { BUILD_HOUSE_ATOMIC_ID } from '../agents/actions.js';
import { jobAtomics } from '../agents/targets/index.js';
import type { SystemContext } from '../context.js';
import { liveWorkFlag } from '../economy/flags.js';
import { buildStaffingTally } from '../economy/jobs/openings.js';
import { isAdultSettler } from '../family/eligibility.js';
import { workFlagPlacementBlocks } from '../footprint/index.js';
import { isFighterJob } from '../readviews/index.js';
import { SCOUT_JOB } from '../readviews/stances.js';
import { canonicalResources, resourcesNearNode } from '../resource-index.js';
import { isCarrierJob } from '../stores/index.js';
import type { AiPlayerModule } from './index.js';
import {
  anchorNodeOf,
  firstRingNode,
  headquartersOf,
  isBuilt,
  ownedBuildings,
  ownedSettlers,
} from './shared.js';
import { nextSignpostTarget } from './signpost-coverage.js';

/**
 * The CollectResources module — the seat's one workforce allocator (user plan, 2026-07-17): every
 * adult non-fighter man defaults to the builder trade (the total reset — the map may hand the seat
 * settlers of any profession), and the wanted roles are drawn back out of that pool in priority
 * order: one flag-bound gatherer per {@link COLLECTED_GOOD_IDS} working beside its resource, one
 * scout while signpost work remains, then one worker per operator trade of each built workplace.
 * Allocation is centralized in this single module so two modules never claim the same settler
 * within one decision; a transient conflict with the live world self-heals on the next decision
 * because every target is recomputed from state, never remembered.
 */

/** The goods the gatherers collect, by stable content id (user plan: clay, stone, wood). An id
 *  absent from the content set — or with no standing resource left on the map — is skipped. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** Workers assigned per (workplace, trade): the user's opening plan staffs each workshop with one
 *  worker per trade (e.g. a single farmer), even when the building offers more slots. */
export const WORKERS_PER_TRADE = 1;

/** A collector's flag stands 2–3 tiles from its resource (user rule) — 4..6 half-cell nodes. */
export const FLAG_MIN_DISTANCE_NODES = 4;
export const FLAG_MAX_DISTANCE_NODES = 6;
/** When the whole 2–3-tile band is blocked, any legal node this close still serves. */
const FLAG_FALLBACK_MAX_DISTANCE_NODES = 12;

/** The lowest job permitted the house-building atomic — the builder trade, resolved from content
 *  the same way the assignBuilder gate checks it — or null when the content has no builder. */
export function builderJobOf(ctx: SystemContext): number | null {
  let best: number | null = null;
  for (const job of ctx.content.jobs) {
    if (!jobAtomics(ctx, job.typeId).has(BUILD_HOUSE_ATOMIC_ID)) continue;
    if (best === null || job.typeId < best) best = job.typeId;
  }
  return best;
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

/** The standing not-yet-empty resource of `goodType` nearest to `from` (Manhattan node distance,
 *  ties to the lower entity id), or null when the map holds none. A full canonical-resources scan —
 *  run only when a collector is hired or its patch runs dry, never per tick. */
function nearestLiveResource(world: World, goodType: number, from: HalfCellNode): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of canonicalResources(world)) {
    const r = world.get(e, Resource);
    if (r.goodType !== goodType || r.remaining <= 0) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

/** Whether any live resource of `goodType` remains inside the flag's work circle (the world-metric
 *  circle the gatherer harvests in) — the "patch ran dry, move the flag" probe. */
function patchAlive(world: World, goodType: number, flagNode: HalfCellNode, radius: number): boolean {
  // The region-index box must contain the anisotropic circle (±radius nodes E/W, wider in rows).
  const box = nodeBoxOfCircles([{ x: flagNode.hx, y: flagNode.hy, r: radius }]);
  const reach = Math.max(box.maxX - flagNode.hx, box.maxY - flagNode.hy);
  for (const e of resourcesNearNode(world, flagNode.hx, flagNode.hy, reach)) {
    const r = world.get(e, Resource);
    if (r.goodType !== goodType || r.remaining <= 0) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    if (withinNodeRadius(flagNode.hx, flagNode.hy, node.hx, node.hy, radius)) return true;
  }
  return false;
}

/** The closest legal work-flag node in the 2–3-tile band around a resource (falling back to any
 *  nearby legal node when the band is fully blocked), or null. One blocker scan per call. */
function flagSpotNear(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  resource: HalfCellNode,
): HalfCellNode | null {
  const blocked = workFlagPlacementBlocks(world, ctx.content, terrain);
  const legal = (x: number, y: number): boolean =>
    terrain.inBounds(x, y) && terrain.isWalkable(terrain.nodeAt(x, y)) && !blocked.has(terrain.nodeAt(x, y));
  const inBand = (x: number, y: number): boolean =>
    Math.abs(x - resource.hx) + Math.abs(y - resource.hy) >= FLAG_MIN_DISTANCE_NODES && legal(x, y);
  return (
    firstRingNode(resource.hx, resource.hy, FLAG_MAX_DISTANCE_NODES, inBand) ??
    firstRingNode(resource.hx, resource.hy, FLAG_FALLBACK_MAX_DISTANCE_NODES, legal)
  );
}

function runWorkforce(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const index = contentIndex(ctx.content);
  const commands: Command[] = [];
  const builderJob = builderJobOf(ctx);
  const terrain = ctx.terrain;

  // The wanted collector goods, in plan order, with each good's gatherer trade resolved.
  const wanted: { good: ContentSet['goods'][number]; harvestAtomic: number; job: number }[] = [];
  for (const goodId of COLLECTED_GOOD_IDS) {
    const good = goodByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    const job = harvestJobFor(ctx, harvestAtomic);
    if (job === null) continue;
    wanted.push({ good, harvestAtomic, job });
  }

  // Classify the seat's adult non-fighter men: employed workers keep their post, the current
  // collector of each wanted good and the scouts are recognized in place, everyone else (civilians,
  // stray trades, duplicate collectors) lands in the spare pool — the builder pool of the plan.
  const pool: Entity[] = [];
  const collectorByGood = new Map<number, Entity>();
  const scouts: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    if (world.has(e, Female) || !isAdultSettler(world, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (isFighterJob(job)) continue; // soldiers stay soldiers — the reset covers civilians only
    if (world.has(e, JobAssignment)) continue; // staffing a building — keep the post
    if (job === SCOUT_JOB) {
      scouts.push(e);
      continue;
    }
    if (job !== null) {
      const goodType = liveWorkFlag(world, e)?.goodType;
      if (
        goodType !== undefined &&
        !collectorByGood.has(goodType) &&
        wanted.some((w) => w.good.typeId === goodType && jobAtomics(ctx, job).has(w.harvestAtomic))
      ) {
        collectorByGood.set(goodType, e);
        continue;
      }
    }
    pool.push(e);
  }
  const used = new Set<Entity>();
  const takeSpare = (): Entity | null => {
    const spare = pool.find((e) => !used.has(e));
    if (spare === undefined) return null;
    used.add(spare);
    return spare;
  };

  // 1. Collectors: one flag-bound gatherer per wanted good, its flag standing 2–3 tiles from the
  // nearest live resource; a dry patch moves the flag to the next resource, a good with no resource
  // left releases its collector back to the pool (user rules, 2026-07-17).
  if (terrain !== undefined) {
    const hqNode = anchorNodeOf(world, hq);
    for (const w of wanted) {
      const holder = collectorByGood.get(w.good.typeId);
      if (holder !== undefined) {
        const flag = liveWorkFlag(world, holder);
        const flagNode = flag === undefined ? null : anchorNodeOf(world, flag.flag);
        if (flag === undefined || flagNode === null) continue; // vanished mid-decision — next pass rehires
        if (patchAlive(world, w.good.typeId, flagNode, flag.radius)) continue;
        const next = nearestLiveResource(world, w.good.typeId, flagNode);
        if (next === null) {
          // The map ran out of this good — the collector rejoins the builder pool.
          if (builderJob !== null) commands.push({ kind: 'setJob', entity: holder, jobType: builderJob });
          continue;
        }
        const node = anchorNodeOf(world, next);
        const spot = node === null ? null : flagSpotNear(world, ctx, terrain, node);
        if (spot !== null) commands.push({ kind: 'setWorkFlag', entity: holder, x: spot.hx, y: spot.hy });
        continue;
      }
      if (hqNode === null) continue;
      const resource = nearestLiveResource(world, w.good.typeId, hqNode);
      if (resource === null) continue; // nothing of this good on the map — no collector wanted
      const node = anchorNodeOf(world, resource);
      const spot = node === null ? null : flagSpotNear(world, ctx, terrain, node);
      if (spot === null) continue;
      const spare = takeSpare();
      if (spare === null) break; // pool dry — the rest waits for grown sons
      commands.push({ kind: 'setJob', entity: spare, jobType: w.job });
      commands.push({ kind: 'setWorkFlag', entity: spare, x: spot.hx, y: spot.hy });
      commands.push({ kind: 'setGatherGood', entity: spare, goodType: w.good.typeId });
    }
  }

  // 2. The scout exists exactly while signpost work remains (user rule: an idle scout turns back
  // into a builder; the ring calls one up again when a post is missing).
  const scoutWanted =
    index.commandJobs.get(SCOUT_JOB) !== undefined && nextSignpostTarget(world, ctx, player) !== null;
  if (scoutWanted && scouts.length === 0) {
    const spare = takeSpare();
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: SCOUT_JOB });
  }
  for (const [i, scout] of scouts.entries()) {
    if (scoutWanted && i === 0) continue; // the working scout — keep
    if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) continue; // let it finish
    if (builderJob !== null) commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }

  // 3. Staff built workplaces: one worker per operator trade (carriers and gatherer slots are not
  // operators — operatorJobsOf's split; a carrier/gatherer-only building keeps its slots).
  const tally = buildStaffingTally(world);
  for (const building of ownedBuildings(world, player)) {
    if (building === hq || !isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined || type.kind !== 'workplace') continue;
    const slots = type.workers.filter(
      (w) => !isCarrierJob(ctx, w.jobType) && !index.harvestJobs.has(w.jobType),
    );
    const operators = slots.length > 0 ? slots : type.workers;
    for (const slot of operators) {
      const held = tally.get(building)?.get(slot.jobType) ?? 0;
      const want = Math.min(slot.count, WORKERS_PER_TRADE);
      for (let i = held; i < want; i++) {
        const spare = takeSpare();
        if (spare === null) return commands; // pool dry — the rest waits for grown sons
        commands.push({ kind: 'assignWorker', entity: spare, building, jobPriority: [slot.jobType] });
      }
    }
  }

  // 4. The total reset: every unclaimed pool man of any other trade becomes a builder.
  if (builderJob !== null) {
    for (const e of pool) {
      if (used.has(e)) continue;
      if (world.get(e, Settler).jobType === builderJob) continue;
      commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
    }
  }
  return commands;
}

export const workforceModule: AiPlayerModule = {
  id: 'collectResources',
  run: runWorkforce,
};
