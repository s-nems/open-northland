import { type ContentSet, footprintCellDx } from '@open-northland/data';
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
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext } from '../context.js';
import { type HouseKey, houseFootprintOf } from '../footprint/geometry.js';
import { houseBow, isFighterJob, isRangedWeapon, WEAPON_MAIN_TYPE } from '../readviews/index.js';
import { hexNodeDistance, nearestHexCell } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { buildingWorkerJobs } from '../stores/index.js';
import { buildingBodyNodes } from './target-node.js';
import { attackerWeapon, type WeaponReach } from './weapons.js';

// The tower post: which one a fighter is entitled to man, whether it is manning one right now, and what
// manning does to its reach.

/**
 * How much reach (map points) a manned post adds to a garrison's bow, for spotting a target and for the shot
 * alike. Owner rule: a posted bow reaches at least as far as the farthest bow a person carries
 * ({@link farthestHandBowReach}), so no archer on the ground outranges a manned tower, and its reach counts
 * from the post's nearest wall, the face an attacker measures its own reach to. Only a man standing on his
 * post has it; a posted man with a melee weapon gains neither.
 */
export const TOWER_RANGE_BONUS_NODES = 4;

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

/** A garrison's reach band, counted from its post's nearest wall ({@link postReachDistance}): a bow's far
 *  reach plus {@link TOWER_RANGE_BONUS_NODES}, at least {@link farthestHandBowReach}, and no near dead zone
 *  (the post shoots at whatever stands under its wall). */
export function garrisonReach(content: ContentSet, held: WeaponReach): WeaponReach {
  let reach = garrisonReaches.get(held);
  if (reach === undefined) {
    reach = isRangedWeapon(held.weapon)
      ? {
          ...held,
          minRange: 0,
          maxRange: postedBowReach(content, held.maxRange),
        }
      : { ...held, minRange: 0 };
    garrisonReaches.set(held, reach);
  }
  return reach;
}

/** Each held reach's garrison band, so a posted fighter's pass allocates none. Held reaches are per content. */
const garrisonReaches = new WeakMap<WeaponReach, WeaponReach>();

/** How far `e`, manning a post ({@link mannedPostOf}), shoots in map points from its nearest wall
 *  ({@link postReachDistance}): the {@link garrisonReach} of the bow he holds, the band his combat search and
 *  swing read. 0 without a bow. */
export function postShotReach(world: World, ctx: ContentContext, e: Entity): number {
  const settler = world.get(e, Settler);
  const held = attackerWeapon(ctx, settler.tribe, settler.jobType, world.tryGet(e, Weapon)?.weaponTypeId);
  return held !== null && isRangedWeapon(held.weapon) ? garrisonReach(ctx.content, held).maxRange : 0;
}

/** The {@link garrisonReach} of a bow that reaches `maxRange` on the ground. */
export function postedBowReach(content: ContentSet, maxRange: number): number {
  return Math.max(maxRange + TOWER_RANGE_BONUS_NODES, farthestHandBowReach(content));
}

/** The farthest any bow a person carries reaches in `content`, the house bow a building fires aside. */
export function farthestHandBowReach(content: ContentSet): number {
  let farthest = farthestHandBows.get(content);
  if (farthest === undefined) {
    farthest = 0;
    for (const weapon of content.weapons) {
      const tribe = weapon.tribeType;
      if (weapon.mainType !== WEAPON_MAIN_TYPE.BOW) continue;
      if (tribe !== undefined && houseBow(content, tribe) === weapon) continue;
      farthest = Math.max(farthest, weapon.maxRange);
    }
    farthestHandBows.set(content, farthest);
  }
  return farthest;
}

const farthestHandBows = new WeakMap<ContentSet, number>();

/** The map-point distance to `mark` that the reach of a man on `post` holding `held` counts: from the post's
 *  nearest wall for a bow, from where he stands, `from`, for a melee weapon. */
export function postReachDistance(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  post: Entity,
  held: WeaponReach,
  from: NodeId,
  mark: NodeId,
): number {
  if (!isRangedWeapon(held.weapon)) return hexNodeDistance(terrain, from, mark);
  const walls = buildingBodyNodes(world, ctx, terrain, post);
  return hexNodeDistance(
    terrain,
    nearestHexCell(terrain, walls, mark) ?? entityNode(world, terrain, post),
    mark,
  );
}

/** How much farther than its {@link garrisonReach} the search from his own node of a man on `post` holding
 *  `held` must look: for a bow, the distance from where he stands, the post's own node, to its farthest wall. */
export function postSpan(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  post: Entity,
  held: WeaponReach,
): number {
  if (!isRangedWeapon(held.weapon)) return 0;
  const walls = buildingBodyNodes(world, ctx, terrain, post);
  let span = postSpans.get(walls);
  if (span === undefined) {
    const at = entityNode(world, terrain, post);
    span = 0;
    for (const wall of walls) span = Math.max(span, hexNodeDistance(terrain, at, wall));
    postSpans.set(walls, span);
  }
  return span;
}

/** {@link postSpan} of a `house` off the map: the farthest of its footprint walls from its anchor, on
 *  either anchor row parity. */
export function houseSpan(content: ContentSet, house: HouseKey): number {
  const cells = houseFootprintOf(content, house)?.blocked ?? [];
  let span = 0;
  for (const hy of ANCHOR_ROWS) {
    for (const cell of cells) {
      span = Math.max(span, hexDistanceBetween(0, hy, footprintCellDx(hy, cell), hy + cell.dy));
    }
  }
  return span;
}

/** An anchor row of each parity, the only part of an anchor a footprint's shape depends on. */
const ANCHOR_ROWS = [0, 1] as const;

/** Each held body's {@link postSpan}: a body is held until its building moves or changes, so the span is too. */
const postSpans = new WeakMap<readonly NodeId[], number>();

/** `band` widened by `span`: the ground a posted man's search from his own node covers, within which
 *  {@link postReachDistance} decides what his {@link garrisonReach} takes. */
export function postSearchBand(band: WeaponReach, span: number): WeaponReach {
  if (span === 0) return band;
  let bySpan = searchBands.get(band);
  if (bySpan === undefined) {
    bySpan = new Map();
    searchBands.set(band, bySpan);
  }
  let widened = bySpan.get(span);
  if (widened === undefined) {
    widened = { ...band, maxRange: band.maxRange + span };
    bySpan.set(span, widened);
  }
  return widened;
}

const searchBands = new WeakMap<WeaponReach, Map<number, WeaponReach>>();
