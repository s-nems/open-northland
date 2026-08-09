import { Building, CurrentAtomic, JobAssignment, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { hunterJobType, isHunterJob } from '../../readviews/index.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';

/**
 * The tier whose completion ends the opening hunt: a chosen milestone late in the build order, which
 * keeps the hunt running while nearby game lasts. No readable source says when the original's opening
 * hunt ends (approximation).
 */
export const OPENING_HUNT_UNTIL_BUILDING_ID = 'work_bakery_01';

/**
 * The opening hunter: one man employed at the seat's base on its hunter slot until
 * {@link OPENING_HUNT_UNTIL_BUILDING_ID} stands built, then handed back to the civilian pool
 * (authored). Employed rather than flag-bound because the post is what gives him the base as his
 * hunting ground and banks his kills into its store as food. Content missing the hunter trade, the
 * base's hunter seat or the milestone tier hires nobody.
 */
export function allocateOpeningHunter(
  world: World,
  ctx: SystemContext,
  player: number,
  base: Entity,
  force: SpareForce,
  builderJob: number | null,
): PlayerCommand[] {
  const hunterJob = hunterJobType(ctx.content);
  if (hunterJob === null) return [];
  if (!offersHunterSeat(world, ctx, base, hunterJob)) return [];
  const posted = huntersAt(world, ctx, player, base);
  if (openingHuntOver(world, ctx, player)) return retireHunters(world, posted, builderJob);
  if (posted.length > 0) return [];
  // Only the per-settler half of the command's own gate is left to ask of a candidate: `posted` above
  // is already this building's whole hunter headcount, since a workplace employs its owner's men alone.
  const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', hunterJob));
  if (spare === null) return [];
  return [{ kind: 'assignWorker', entity: spare, building: base, jobPriority: [hunterJob] }];
}

function huntersAt(world: World, ctx: SystemContext, player: number, base: Entity): Entity[] {
  return ownedSettlers(world, player).filter(
    (e) =>
      world.tryGet(e, JobAssignment)?.workplace === base &&
      isHunterJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** Whether the base's building type declares a `hunterJob` worker slot at all. */
function offersHunterSeat(world: World, ctx: SystemContext, base: Entity, hunterJob: number): boolean {
  const type = contentIndex(ctx.content).buildings.get(world.get(base, Building).buildingType);
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

/** Hand the opening hunters back to the pool as builders, leaving a man mid-action alone. */
function retireHunters(world: World, posted: readonly Entity[], builderJob: number | null): PlayerCommand[] {
  if (builderJob === null) return [];
  return posted
    .filter((e) => !world.has(e, CurrentAtomic))
    .map((e) => ({ kind: 'setJob', entity: e, jobType: builderJob }));
}
