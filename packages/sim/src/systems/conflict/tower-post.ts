import {
  Building,
  Garrison,
  JobAssignment,
  Position,
  Settler,
  UnderConstruction,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isFighterJob, isRangedWeapon } from '../readviews/index.js';
import { buildingWorkerJobs } from '../stores/index.js';
import { attackerWeapon, type WeaponReach } from './weapons.js';

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
 * The post `e` is entitled to man: the built building its {@link JobAssignment} binds it to,
 * when that building offers its exact fighting class as a worker slot (the towers' `logicworker 40/41`
 * bow-soldier posts; `jobtypes.ini` marks those classes `canHaveWorkHouseFlag 1`). Null for every settler
 * that is not a posted fighter. Re-derived rather than remembered, so a garrison whose tower fell or whose
 * trade changed stops qualifying the same tick.
 */
export function towerPostFor(world: World, ctx: ContentContext, e: Entity, jobType: number): Entity | null {
  if (!isFighterJob(ctx.content, jobType)) return null;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (workplace === undefined || !world.isAlive(workplace)) return null;
  const b = world.tryGet(workplace, Building);
  if (b === undefined) return null;
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
export function isManningPost(world: World, ctx: ContentContext, e: Entity): boolean {
  return mannedPostOf(world, ctx, e) !== null;
}

/** The post `e` is holding ({@link isManningPost}), or null. */
export function mannedPostOf(world: World, ctx: ContentContext, e: Entity): Entity | null {
  const post = standsAtPost(world, e);
  return post !== null && holdsPost(world, ctx, e, post) ? post : null;
}

/** Whether `e`, standing on `post` ({@link standsAtPost}), is still entitled to it ({@link towerPostFor}). */
export function holdsPost(world: World, ctx: ContentContext, e: Entity, post: Entity): boolean {
  const jobType = world.tryGet(e, Settler)?.jobType;
  return jobType != null && towerPostFor(world, ctx, e, jobType) === post;
}

/** A garrison's reach band: a bow's far reach plus {@link TOWER_RANGE_BONUS_NODES}, and no near dead zone
 *  (original behavior - the post shoots at whatever stands under its wall). */
export function garrisonReach(held: WeaponReach): WeaponReach {
  let reach = garrisonReaches.get(held);
  if (reach === undefined) {
    reach = isRangedWeapon(held.weapon)
      ? { ...held, minRange: 0, maxRange: held.maxRange + TOWER_RANGE_BONUS_NODES }
      : { ...held, minRange: 0 };
    garrisonReaches.set(held, reach);
  }
  return reach;
}

/** Each held reach's garrison band, so a posted fighter's pass allocates none. */
const garrisonReaches = new WeakMap<WeaponReach, WeaponReach>();

/** How far `e`, manning a post ({@link mannedPostOf}), shoots from it in map points: the
 *  {@link garrisonReach} of the bow he holds, the band his combat search and swing read. 0 without a bow. */
export function postShotReach(world: World, ctx: ContentContext, e: Entity): number {
  const settler = world.get(e, Settler);
  const held = attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
  return held !== null && isRangedWeapon(held.weapon) ? garrisonReach(held).maxRange : 0;
}
