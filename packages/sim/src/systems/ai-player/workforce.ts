import type { ContentSet } from '@open-northland/data';
import { Building, Female, GatherSelection, JobAssignment, Settler } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { BUILD_HOUSE_ATOMIC_ID } from '../agents/actions.js';
import { jobAtomics } from '../agents/targets/index.js';
import type { SystemContext } from '../context.js';
import { buildStaffingTally } from '../economy/jobs/openings.js';
import { isAdultSettler } from '../family/eligibility.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { SCOUT_JOB } from '../readviews/stances.js';
import { isCarrierJob } from '../stores/index.js';
import type { AiPlayerModule } from './index.js';
import { headquartersOf, isBuilt, ownedBuildings, ownedSettlers } from './shared.js';

/**
 * The CollectResources module — the seat's one workforce allocator (user plan, 2026-07-17): keep one
 * gatherer per {@link COLLECTED_GOOD_IDS} banking into the headquarters, keep one scout, staff each
 * built workplace's operator trades from the builder pool, and turn every remaining civilian man
 * into a builder. Allocation is centralized in this single module so two modules never claim the
 * same settler within one decision; a transient conflict with the live world self-heals on the next
 * decision because every target is recomputed from state, never remembered.
 */

/** The goods the headquarters gatherers collect, by stable content id (user plan: clay, stone,
 *  wood). An id absent from the content set is skipped. */
export const COLLECTED_GOOD_IDS: readonly string[] = ['mud', 'stone', 'wood'];

/** Workers assigned per (workplace, trade): the user's opening plan staffs each workshop with one
 *  worker per trade (e.g. a single farmer), even when the building offers more slots. */
export const WORKERS_PER_TRADE = 1;

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

function runWorkforce(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const index = contentIndex(ctx.content);
  const commands: Command[] = [];
  const builderJob = builderJobOf(ctx);

  // The spare pool: unassigned adult men, civilians first, then builders (the user's rule — workers
  // are drawn from, and thin out, the builder pool). Women never take a trade (the Female job-guard).
  const civilians: Entity[] = [];
  const builders: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    if (world.has(e, Female) || !isAdultSettler(world, e)) continue;
    if (world.has(e, JobAssignment)) continue; // already staffing a building
    const job = world.get(e, Settler).jobType;
    if (job === null || job === CIVILIST_JOB) civilians.push(e);
    else if (job === builderJob) builders.push(e);
  }
  const used = new Set<Entity>();
  const takeSpare = (): Entity | null => {
    const spare = civilians.find((e) => !used.has(e)) ?? builders.find((e) => !used.has(e));
    if (spare === undefined) return null;
    used.add(spare);
    return spare;
  };

  // 1. Headquarters gatherers: one bound harvest-trade settler per collected good, its selection
  // pinned with setGatherGood (the building-assigned-gatherer mechanism banks the harvest into HQ).
  commands.push(...collectorCommands(world, ctx, player, hq, takeSpare));

  // 2. One scout (erects the guideBuild module's signposts). setJob is skipped for content without
  // the scout trade.
  if (index.commandJobs.get(SCOUT_JOB) !== undefined) {
    const hasScout = ownedSettlers(world, player).some((e) => world.get(e, Settler).jobType === SCOUT_JOB);
    if (!hasScout) {
      const spare = takeSpare();
      if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: SCOUT_JOB });
    }
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

  // 4. Every remaining civilian man becomes a builder (the user's default trade).
  if (builderJob !== null) {
    for (const e of civilians) {
      if (used.has(e)) continue;
      commands.push({ kind: 'setJob', entity: e, jobType: builderJob });
    }
  }
  return commands;
}

/** See step 1 of {@link runWorkforce}: reconcile the HQ gatherer trio against the live world. */
function collectorCommands(
  world: World,
  ctx: SystemContext,
  player: number,
  hq: Entity,
  takeSpare: () => Entity | null,
): Command[] {
  const index = contentIndex(ctx.content);
  const commands: Command[] = [];
  const hqType = index.buildings.get(world.get(hq, Building).buildingType);
  if (hqType === undefined) return [];
  const slotJobs = hqType.workers
    .map((w) => w.jobType)
    .filter((j) => index.harvestJobs.has(j))
    .sort((a, b) => a - b);
  if (slotJobs.length === 0) return [];

  // The bound HQ harvesters and the goods they already claim.
  const claimed = new Set<number>();
  const unselected: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    const assignment = world.tryGet(e, JobAssignment);
    if (assignment === undefined || assignment.workplace !== hq) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null || !index.harvestJobs.has(job)) continue;
    const selection = world.tryGet(e, GatherSelection);
    if (selection === undefined) unselected.push(e);
    else claimed.add(selection.goodType);
  }

  for (const goodId of COLLECTED_GOOD_IDS) {
    const good = goodByContentId(ctx.content, goodId);
    const harvestAtomic = good?.atomics?.harvest;
    if (good === undefined || harvestAtomic === undefined) continue; // not in this content set
    if (claimed.has(good.typeId)) continue;
    // A bound harvester without a selection re-pins to the missing good before a new settler is hired.
    const reuseAt = unselected.findIndex((e) => {
      const job = world.get(e, Settler).jobType;
      return job !== null && jobAtomics(ctx, job).has(harvestAtomic);
    });
    const reuse = reuseAt >= 0 ? unselected[reuseAt] : undefined;
    if (reuse !== undefined) {
      unselected.splice(reuseAt, 1);
      commands.push({ kind: 'setGatherGood', entity: reuse, goodType: good.typeId });
      continue;
    }
    const slotJob = slotJobs.find((j) => jobAtomics(ctx, j).has(harvestAtomic));
    if (slotJob === undefined) continue; // HQ offers no trade that harvests this good
    const spare = takeSpare();
    if (spare === null) return commands;
    commands.push({ kind: 'assignWorker', entity: spare, building: hq, jobPriority: [slotJob] });
    commands.push({ kind: 'setGatherGood', entity: spare, goodType: good.typeId });
  }
  return commands;
}

export const workforceModule: AiPlayerModule = {
  id: 'collectResources',
  run: runWorkforce,
};
