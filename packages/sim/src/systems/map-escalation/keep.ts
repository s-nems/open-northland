import type { ContentSet, MapSiege, MapSiegeTarget } from '@open-northland/data';
import { Building, isPlayerDead, JobAssignment, Position } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { removeSettlerSilently } from '../lifecycle/death.js';
import { spawnSettler } from '../spawn/index.js';
import { apportion } from './schedule.js';

/** The tribe type the siege's men belong to; undefined when the content lacks its slug. */
export function siegeTribe(ctx: SystemContext, siege: MapSiege): number | undefined {
  return contentIndex(ctx.content).tribeTypeBySlug.get(siege.tribe);
}

/** `count` men of the siege's mix as job types, split by {@link apportion}; a trade the content lacks
 *  sends nobody. */
export function siegeJobs(ctx: SystemContext, siege: MapSiege, count: number): number[] {
  const bySlug = contentIndex(ctx.content).jobTypeBySlug;
  return apportion(siege.jobMix, count).flatMap((slug) => {
    const jobType = bySlug.get(slug);
    return jobType === undefined ? [] : [jobType];
  });
}

/** Make a man of the siege's tribe at the stronghold point for `owner`. */
export function spawnAtKeep(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  jobType: number,
  owner: number,
): Entity | null {
  const tribe = siegeTribe(ctx, siege);
  if (tribe === undefined) return null;
  return spawnSettler(world, ctx, {
    kind: 'spawnSettler',
    jobType,
    tribe,
    x: siege.stronghold.x,
    y: siege.stronghold.y,
    owner,
  });
}

/**
 * Make a man of the stronghold seat at the stronghold point, posted to `workplace` (anchored on
 * `anchor`). A man the workplace will not take is removed again, so a refused post leaves nobody for
 * the next beat to add to. Null when nobody was posted.
 */
export function spawnPostedAtKeep(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  jobType: number,
  workplace: Entity,
  anchor: HalfCellNode,
): Entity | null {
  const tribe = siegeTribe(ctx, siege);
  if (tribe === undefined) return null;
  const e = spawnSettler(world, ctx, {
    kind: 'spawnSettler',
    jobType,
    tribe,
    x: siege.stronghold.x,
    y: siege.stronghold.y,
    owner: siege.stronghold.seat,
    workplace: { x: anchor.hx, y: anchor.hy },
  });
  if (e === null) return null;
  if (world.tryGet(e, JobAssignment)?.workplace === workplace) return e;
  removeSettlerSilently(world, e);
  return null;
}

/** The stronghold seat is still in the match and its keep stands. The raider seats launch on
 *  regardless: they never die, so a fallen stronghold seat with its keep standing still sends its
 *  scheduled attacks. */
export function fortressHolds(world: World, content: ContentSet, siege: MapSiege): boolean {
  return !isPlayerDead(world, siege.stronghold.seat) && keepStands(world, content, siege);
}

/** A finished keep of the stronghold seat stands within its range of the stronghold point. */
export function keepStands(world: World, content: ContentSet, siege: MapSiege): boolean {
  const { seat, building, x, y, range } = siege.stronghold;
  const buildingType = contentIndex(content).buildingTypeBySlug.get(building);
  if (buildingType === undefined) return false;
  for (const e of ownedBuildings(world, seat)) {
    if (world.get(e, Building).buildingType !== buildingType || !isBuilt(world, e)) continue;
    const at = world.tryGet(e, Position);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    if (hexDistanceBetween(node.hx, node.hy, x, y) < range) return true;
  }
  return false;
}

/**
 * The targets whose seat is occupied: it has people and the match has not counted it out. A lobby seat
 * left empty has none, and an idle computer seat's people count like any other's.
 */
export function occupiedTargets(world: World, siege: MapSiege): MapSiegeTarget[] {
  return siege.attacks.targets.filter(
    (target) => ownedSettlers(world, target.seat).length > 0 && !isPlayerDead(world, target.seat),
  );
}
