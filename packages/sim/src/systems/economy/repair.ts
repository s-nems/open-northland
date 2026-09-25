import { Building, Damaged, Health, UnderConstruction, Upgrading } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { toolWorkFactorPct } from '../equipment/index.js';
import { buildStepsPerSwing, jobExperiencePercent } from '../progression/index.js';

/** Hitpoints one construction step gives back to a damaged building. Original behavior: repair takes no
 *  material, and a swing is worth the same steps as on a construction site. */
const HITPOINTS_PER_REPAIR_STEP = 100;

/** Builders one damaged building takes at a time. Original behavior. */
export const REPAIR_CREW_LIMIT = 5;

/** Record damage that just landed on `e`: a building left short of its max Health is marked, or has its
 *  mark re-stamped with this tick. */
export function markBuildingDamaged(world: World, ctx: SystemContext, e: Entity): void {
  if (!world.has(e, Building)) return;
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0 || health.hitpoints >= health.max) return;
  world.add(e, Damaged, { lastHitTick: ctx.tick });
}

/** Drop the damage mark once the building's Health is whole again, or gone, whoever changed it. */
export function clearRepairedDamage(world: World, e: Entity): void {
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints >= health.max) world.remove(e, Damaged);
}

/**
 * Whether builders may mend `e` now: a standing, damaged building or upgrade site. A foundation still
 * rising is not mended; its pool climbs with the build and fills on completion. Original behavior.
 */
export function needsRepair(world: World, e: Entity): boolean {
  if (!world.has(e, Damaged)) return false;
  if (world.has(e, UnderConstruction) && !world.has(e, Upgrading)) return false;
  const health = world.tryGet(e, Health);
  return health !== undefined && health.hitpoints > 0 && health.hitpoints < health.max;
}

/**
 * One repair swing of `builder` at `site`, the `repair` atomic's effect: the steps its experience and tool
 * are worth, each restoring {@link HITPOINTS_PER_REPAIR_STEP}, clamped to the max. True when hitpoints
 * were restored.
 */
export function repairBuilding(world: World, ctx: SystemContext, site: Entity, builder: Entity): boolean {
  if (!world.isAlive(site) || !needsRepair(world, site)) return false;
  const steps = buildStepsPerSwing(
    jobExperiencePercent(world, ctx, builder, null),
    toolWorkFactorPct(world, ctx, builder),
  );
  if (steps <= 0) return false;
  const health = world.mut(site, Health);
  health.hitpoints = Math.min(health.max, health.hitpoints + steps * HITPOINTS_PER_REPAIR_STEP);
  clearRepairedDamage(world, site);
  return true;
}
