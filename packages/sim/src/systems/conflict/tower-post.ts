import type { WeaponType } from '@open-northland/data';
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
import { isFighterJob, isRangedWeapon } from '../readviews/index.js';
import { buildingWorkerJobs } from '../stores/index.js';

// The tower post: which one a fighter is entitled to man, whether it is manning one right now, and what
// manning does to its reach.

/**
 * How much reach (map points) a manned post adds to a garrison's bow, for spotting a target
 * and for the shot alike: the short bow's extracted `maximumrange 15` reaches 20 from the tower, the long
 * bow's 23 reaches 28. Original behavior; a posted man with a melee weapon gains nothing. Intentional
 * deviation: the original grants it to a posted bowman wherever he stands; here only one standing on his
 * post has it, since the reach comes from the tower and a man shooting that far on his walk up would look
 * wrong.
 */
export const TOWER_RANGE_BONUS_NODES = 5;

/**
 * The post `e` is entitled to man: the built, same-tribe building its {@link JobAssignment} binds it to,
 * when that building offers its exact fighting class as a worker slot (the towers' `logicworker 40/41`
 * bow-soldier posts; `jobtypes.ini` marks those classes `canHaveWorkHouseFlag 1`). Null for every settler
 * that is not a posted fighter. Re-derived rather than remembered, so a garrison whose tower fell or whose
 * trade changed stops qualifying the same tick.
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
 * The post `e` is physically standing on, or null - the {@link Garrison} marker confirmed against the
 * settler's tile. Position, not the marker alone, is the authority: another drive can march a garrison off
 * its tower, and a settler carrying a stale marker must not keep the tower's reach or its untargetability
 * out in the open. Kept to two component reads and a coordinate compare, because the combat target search
 * asks it of every candidate.
 */
export function standsAtPost(world: World, e: Entity): Entity | null {
  const held = world.tryGet(e, Garrison);
  if (held === undefined) return null;
  const pos = world.tryGet(e, Position);
  const at = world.tryGet(held.post, Position);
  if (pos === undefined || at === undefined) return null; // razed out from under it
  return pos.x === at.x && pos.y === at.y ? held.post : null;
}

/** Whether `e` is holding its post: standing on it ({@link standsAtPost}) and still entitled to it
 *  ({@link towerPostFor}). */
export function isManningPost(world: World, ctx: SystemContext, e: Entity): boolean {
  const post = standsAtPost(world, e);
  if (post === null) return false;
  const jobType = world.tryGet(e, Settler)?.jobType;
  return jobType != null && towerPostFor(world, ctx, e, jobType) === post;
}

/** A garrison's reach band: a bow's far reach plus {@link TOWER_RANGE_BONUS_NODES}, and no near dead zone
 *  (original behavior - the post shoots at whatever stands under its wall). */
export function garrisonReach<T extends { minRange: number; maxRange: number; weapon: WeaponType }>(
  held: T,
): T {
  if (!isRangedWeapon(held.weapon)) return { ...held, minRange: 0 };
  return { ...held, minRange: 0, maxRange: held.maxRange + TOWER_RANGE_BONUS_NODES };
}
