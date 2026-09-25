import {
  Building,
  Damaged,
  Health,
  ownerOf,
  Palisade,
  SiteAssignment,
  UnderConstruction,
  Upgrading,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { toolWorkFactorPct } from '../equipment/index.js';
import { buildStepsPerSwing, jobExperiencePercent } from '../progression/index.js';

/** Hitpoints one construction step gives back to a damaged building. Original behavior: repair takes no
 *  material, and a swing is worth the same steps as on a construction site. Approximation: the original
 *  spends a swing's steps left over once the pool is whole on a damaged upgrade site's progress; here the
 *  repair swing ends with the pool. A wall takes its own record's gain per swing instead. */
const HITPOINTS_PER_REPAIR_STEP = 100;

/** Builders one damaged building takes at a time, the player's own orders included. Original behavior
 *  for a standing building; approximation for a damaged upgrade site, where the original also admits one
 *  builder per construction good still owed. */
export const REPAIR_CREW_LIMIT = 5;

/** Builders one damaged wall takes at a time: a single node leaves room beside it for one, as a new
 *  segment has one builder. Project rule. */
export const WALL_REPAIR_CREW_LIMIT = 1;

/** The repair crew limit of `site`, a wall's or a building's. */
export function repairCrewLimit(world: World, site: Entity): number {
  return world.has(site, Palisade) ? WALL_REPAIR_CREW_LIMIT : REPAIR_CREW_LIMIT;
}

/** A building, or a wall with an owner: an unowned wall has no crew to mend it. */
function mendable(world: World, e: Entity): boolean {
  return world.has(e, Building) || (world.has(e, Palisade) && ownerOf(world, e) !== undefined);
}

/** Record damage that just landed on `e`: a building or wall left short of its max Health is marked, or
 *  has its mark re-stamped with this tick. */
export function markStructureDamaged(world: World, ctx: SystemContext, e: Entity): void {
  if (!mendable(world, e)) return;
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0 || health.hitpoints >= health.max) return;
  world.add(e, Damaged, { lastHitTick: ctx.tick });
}

/** Mark `e` short of its max Health with no blow behind it, keeping an existing mark's last hit. */
export function markShortPool(world: World, e: Entity): void {
  if (world.has(e, Damaged) || !mendable(world, e)) return;
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0 || health.hitpoints >= health.max) return;
  world.add(e, Damaged, { lastHitTick: null });
}

/** Drop the damage mark once the structure's Health is whole again, or gone, whoever changed it. */
export function clearRepairedDamage(world: World, e: Entity): void {
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints >= health.max) world.remove(e, Damaged);
}

/**
 * Whether builders may mend `e` now: a standing, damaged building, upgrade site or wall. A foundation or
 * wall segment still rising is not mended; its pool climbs with the build and fills on completion.
 * Original behavior for buildings.
 */
export function needsRepair(world: World, e: Entity): boolean {
  if (!world.has(e, Damaged)) return false;
  if (world.has(e, UnderConstruction) && !world.has(e, Upgrading)) return false;
  const health = world.tryGet(e, Health);
  return health !== undefined && health.hitpoints > 0 && health.hitpoints < health.max;
}

/** Builders whose site is `site`, pinned or not. Scans every assignment, so callers are commands and the
 *  planner's once-per-pass tally, not per-builder queries. */
export function builderCrewSize(world: World, site: Entity): number {
  let crew = 0;
  for (const builder of world.query(SiteAssignment)) {
    if (world.get(builder, SiteAssignment).site === site) crew++;
  }
  return crew;
}

/**
 * One repair swing of `builder` at `site`, the `repair` atomic's effect, clamped to the max. A building
 * gets the steps the builder's experience and tool are worth, each restoring
 * {@link HITPOINTS_PER_REPAIR_STEP}. A wall gets its record's readable repair gain per swing, an amount
 * the original applies per strike; that experience and tool leave it alone is an approximation. True
 * when hitpoints were restored.
 */
export function repairStructure(world: World, ctx: SystemContext, site: Entity, builder: Entity): boolean {
  if (!world.isAlive(site) || !needsRepair(world, site)) return false;
  const steps = buildStepsPerSwing(
    jobExperiencePercent(world, ctx, builder, null),
    toolWorkFactorPct(world, ctx, builder),
  );
  if (steps <= 0) return false;
  const wall = world.tryGet(site, Palisade);
  const restored = wall !== undefined ? wall.repairPerStrike : steps * HITPOINTS_PER_REPAIR_STEP;
  const health = world.mut(site, Health);
  health.hitpoints = Math.min(health.max, health.hitpoints + restored);
  clearRepairedDamage(world, site);
  return true;
}
