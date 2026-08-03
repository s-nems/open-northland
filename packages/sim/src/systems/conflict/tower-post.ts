import {
  Building,
  Garrison,
  JobAssignment,
  Position,
  Settler,
  UnderConstruction,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { buildingWorkerJobs } from '../stores/index.js';

// The tower post: which one a fighter is entitled to man, whether it is manning one right now, and what
// manning does to its reach. The drive that walks it in and holds it there is
// `settlers/drives/tower-post.ts`; the combat branch it feeds is ./engage-combatant.ts.

/**
 * How much reach (Manhattan half-cell nodes) a manned post adds to the garrison's own bow, so a tower
 * archer outranges the ground: the short bow's extracted `maximumrange 15` reaches 23 from the wall - what
 * a long bow covers standing in the field - and the long bow's 23 reaches 31.
 *
 * APPROXIMATED (user rule 2026-08-03: flat, and sized so a ground archer cannot outrange a manned tower).
 * No readable record rates a building's height bonus; the nearest data anchor is the `house_bow`
 * (`weapons.ini` type 20), the weapon a building itself fires, whose 29 sits between the two boosted bows.
 */
export const TOWER_RANGE_BONUS_NODES = 8;

/**
 * A garrison's near reach: no dead zone, so an enemy battering the tower's own wall cannot stand safely
 * under it. APPROXIMATED by analogy - the datum is real but belongs to another weapon: the `house_bow` a
 * BUILDING fires (`weapons.ini` type 20, jobtype 6) carries `minimumrange 0` where every hand bow has a
 * 3-4 node dead zone, and firing from cover is read as the building's case. The value is `1`, not `0`,
 * because `weapons.ts` `withReach` clamps every band to at least 1 - distance 0 is the unit's own node.
 */
const GARRISON_MIN_RANGE = 1;

/**
 * The post `e` is entitled to man: the built, same-tribe building its {@link JobAssignment} binds it to,
 * when that building offers its exact fighting class as a worker slot (the towers' `logicworker 40/41`
 * bow-soldier posts; `jobtypes.ini` marks those classes `canHaveWorkHouseFlag 1`, so a soldier holding a
 * workplace is the data's own shape). Null for every settler that is not a posted fighter.
 *
 * Re-derived rather than remembered, so a garrison whose tower fell, whose trade changed, or who was
 * re-assigned elsewhere stops qualifying the same tick.
 */
export function towerPostFor(world: World, ctx: SystemContext, e: Entity, jobType: number): Entity | null {
  if (!isFighterJob(ctx.content, jobType)) return null;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (workplace === undefined || !world.isAlive(workplace)) return null;
  const b = world.tryGet(workplace, Building);
  if (b === undefined || b.tribe !== world.get(e, Settler).tribe) return null;
  // `jobtypes.ini` gives every soldier class `mustHaveFinishedWorkHouseFlag 1`: the post has to be raised
  // before it can be manned.
  if (world.has(workplace, UnderConstruction)) return null;
  if (!buildingWorkerJobs(world, ctx, workplace).has(jobType)) return null;
  return workplace;
}

/**
 * The post `e` is physically standing on, or null - the {@link Garrison} marker CONFIRMED against the
 * settler's tile. Position, not the marker alone, is the authority: any other drive (a player walk, an
 * equip errand, a drill, a flee) can march a garrison off its tower without passing through
 * `settlers/indoors.ts`, and a settler still carrying a stale marker must not keep the tower's reach or
 * its untargetability out in the open.
 *
 * Cheap on purpose - two component reads and a coordinate compare, no content lookup - because the combat
 * ring search asks it of every candidate ({@link import('./targeting.js').isValidTarget}).
 */
export function standsAtPost(world: World, e: Entity): Entity | null {
  const held = world.tryGet(e, Garrison);
  if (held === undefined) return null;
  const pos = world.tryGet(e, Position);
  const at = world.tryGet(held.post, Position);
  if (pos === undefined || at === undefined) return null; // razed out from under it
  return pos.x === at.x && pos.y === at.y ? held.post : null;
}

/** Whether `e` is holding its post: standing on it ({@link standsAtPost}) AND still entitled to
 *  ({@link towerPostFor}). The planner's test for whether the settler stays in the tower through a
 *  re-plan; the CombatSystem composes the same two halves from the entitlement it already resolved. */
export function isManningPost(world: World, ctx: SystemContext, e: Entity): boolean {
  const post = standsAtPost(world, e);
  if (post === null) return false;
  const jobType = world.tryGet(e, Settler)?.jobType;
  return jobType != null && towerPostFor(world, ctx, e, jobType) === post;
}

/** A garrison's reach band: its weapon's far reach plus {@link TOWER_RANGE_BONUS_NODES}, with the near
 *  dead zone dropped ({@link GARRISON_MIN_RANGE}). */
export function garrisonReach<T extends { minRange: number; maxRange: number }>(weapon: T): T {
  return { ...weapon, minRange: GARRISON_MIN_RANGE, maxRange: weapon.maxRange + TOWER_RANGE_BONUS_NODES };
}
