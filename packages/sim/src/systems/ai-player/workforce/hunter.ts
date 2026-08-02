import { Building, CurrentAtomic, JobAssignment, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { hunterJobType, isHunterJob } from '../../readviews/index.js';
import {
  buildingTypeByContentId,
  isBuilt,
  ownedBuildings,
  ownedSettlers,
  tiersAtOrAbove,
} from '../shared.js';
import type { SpareForce } from './pool.js';

/**
 * The tier whose completion ends the opening hunt (user plan): the level-2 bakery. A chosen milestone,
 * not a derived one. It is NOT the point bread starts flowing (`work_bakery_00` already makes it with
 * one baker); it is simply late in the build order, which keeps the hunt running while nearby game
 * lasts. No readable source says when the original's opening hunt ends (approximation).
 *
 * Retiring the last hunter also switches off a tech branch the seat still wants, which is deferred in
 * `docs/tickets/sim/ai-retires-its-own-leather-unlock.md`.
 */
export const OPENING_HUNT_UNTIL_BUILDING_ID = 'work_bakery_01';

/**
 * The opening hunter: ONE man employed at the headquarters on its {@link isHunterJob} slot until
 * {@link OPENING_HUNT_UNTIL_BUILDING_ID} stands built, then handed back to the civilian pool (user
 * plan). Employed rather than flag-bound because the two are mutually exclusive
 * (`syncWorkFlagToJob`): the post is what gives him the headquarters as his hunting ground
 * (`conflict/hunting-ground.ts`) and banks his kills into its store as food (`bankedSlot`).
 *
 * Content missing either half of that plan, the hunter trade or the headquarters seat or the
 * milestone tier, expresses no opening hunt and hires nobody (the plan's skip-missing-content
 * contract). The two content gates come first: they are O(1) reads that decide the whole phase, and
 * neither the seat nor the trade can appear mid-sim.
 */
export function allocateOpeningHunter(
  world: World,
  ctx: SystemContext,
  player: number,
  hq: Entity,
  force: SpareForce,
  builderJob: number | null,
): Command[] {
  const hunterJob = hunterJobType(ctx.content);
  if (hunterJob === null) return [];
  if (!offersHunterSeat(world, ctx, hq, hunterJob)) return [];
  const posted = huntersAt(world, ctx, player, hq);
  if (openingHuntOver(world, ctx, player)) return retireHunters(world, posted, builderJob);
  if (posted.length > 0) return [];
  // Only the per-settler half of the command's own gate is left to ask of a candidate; the capacity
  // half is `posted` above, which is this headquarters' whole hunter headcount (a workplace employs
  // its owner's men alone).
  const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', hunterJob));
  if (spare === null) return [];
  return [{ kind: 'assignWorker', entity: spare, building: hq, jobPriority: [hunterJob] }];
}

function huntersAt(world: World, ctx: SystemContext, player: number, hq: Entity): Entity[] {
  return ownedSettlers(world, player).filter(
    (e) =>
      world.tryGet(e, JobAssignment)?.workplace === hq &&
      isHunterJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** Whether the headquarters type declares a `hunterJob` worker slot at all. */
function offersHunterSeat(world: World, ctx: SystemContext, hq: Entity, hunterJob: number): boolean {
  const type = contentIndex(ctx.content).buildings.get(world.get(hq, Building).buildingType);
  return type?.workers.some((w) => w.jobType === hunterJob && w.count > 0) ?? false;
}

/** Whether the seat has finished the milestone that ends the opening hunt: a built building at the
 *  named tier or above on its upgrade chain. True on content lacking the tier. */
function openingHuntOver(world: World, ctx: SystemContext, player: number): boolean {
  const target = buildingTypeByContentId(ctx.content, OPENING_HUNT_UNTIL_BUILDING_ID);
  if (target === undefined) return true;
  const tiers = tiersAtOrAbove(contentIndex(ctx.content), target);
  return ownedBuildings(world, player).some(
    (e) => isBuilt(world, e) && tiers.has(world.get(e, Building).buildingType),
  );
}

/** Hand the opening hunters back to the pool as builders, under the scout's mid-action rule
 *  (`allocateScout`). */
function retireHunters(world: World, posted: readonly Entity[], builderJob: number | null): Command[] {
  if (builderJob === null) return [];
  return posted
    .filter((e) => !world.has(e, CurrentAtomic))
    .map((e) => ({ kind: 'setJob', entity: e, jobType: builderJob }));
}
