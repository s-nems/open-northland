import type { ContentSet } from '@open-northland/data';
import {
  Age,
  Female,
  Marriage,
  Person,
  Position,
  Settler,
  TrainingOrder,
  Wedding,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { isNonWorkingAge } from '../lifecycle/ageclass.js';
import { isFighterJob, isScoutJob } from '../readviews/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import { canonicalById } from '../spatial/nodes.js';
import { isMinor } from './households.js';

/**
 * The job `id` slugs that carry the female sex in `jobtypes.ini`. Matched by slug, not numeric id: a
 * synthetic fixture may reuse a low numeric id for an adult trade, and a slug cannot collide that way.
 */
const FEMALE_JOB_IDS: ReadonlySet<string> = new Set([
  'baby_female',
  'child_female',
  'woman',
  'heroine_bow_xena',
]);

export function isFemaleJobId(id: string | undefined): boolean {
  return id !== undefined && FEMALE_JOB_IDS.has(id);
}

/**
 * Whether a settler of `jobType` is away on a mission, a fighter or the scout: it neither marries nor
 * comes home to its family, and reverting to a civilian trade restores family life. Authored, over the
 * content-derived job roles.
 */
export function isOnMission(content: ContentSet, jobType: number | null): boolean {
  return isFighterJob(content, jobType) || isScoutJob(content, jobType);
}

/** Whether `e` is a grown person: a {@link Person} with no {@link Age}, the born-young marker, and no
 *  age-class job. A claimed cow is a jobless {@link Settler} and would otherwise read as an adult. */
export function isAdultSettler(world: World, e: Entity): boolean {
  if (!world.has(e, Person) || world.has(e, Age)) return false;
  return !isNonWorkingAge(world.get(e, Settler).jobType);
}

/** Whether `e` currently counts as married: a {@link Marriage} to a living spouse, or a widowed parent
 *  still raising the couple's minor child. */
export function isMarried(world: World, e: Entity): boolean {
  const marriage = world.tryGet(e, Marriage);
  return marriage !== undefined && (world.isAlive(marriage.spouse) || raisingChild(world, marriage));
}

/** Whether `e` may enter a marriage right now. A pending barracks drill disqualifies: the trade is still
 *  civilian mid-walk, but the drill's end would strand the spouse. */
export function mayMarry(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.isAlive(e) || !isAdultSettler(world, e)) return false;
  if (world.has(e, Wedding) || world.has(e, TrainingOrder)) return false;
  if (isMarried(world, e)) return false;
  return !isOnMission(content, world.get(e, Settler).jobType);
}

export function raisingChild(world: World, marriage: { child: Entity | null }): boolean {
  return marriage.child !== null && world.isAlive(marriage.child) && isMinor(world, marriage.child);
}

/**
 * The nearest eligible partner for `seeker`, or null when none exists. Nearest by half-cell Manhattan
 * distance with an ascending-entity-id tie-break, so the winner never depends on store insertion order;
 * under signpost navigation a partner outside the seeker's allowed area is not eligible.
 */
export function findPartnerFor(
  world: World,
  content: ContentSet,
  seeker: Entity,
  terrain: TerrainGraph | undefined,
  limit: NavigationLimit | null,
): Entity | null {
  const seekerPos = world.tryGet(seeker, Position);
  if (seekerPos === undefined) return null;
  const from = nodeOfPosition(seekerPos.x, seekerPos.y);
  const tribe = world.get(seeker, Settler).tribe;
  const seekerFemale = world.has(seeker, Female);
  let best: { entity: Entity; dist: number } | null = null;
  for (const e of canonicalById(world.query(Person, Position))) {
    if (e === seeker || !mayMarry(world, content, e)) continue;
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (world.has(e, Female) === seekerFemale) continue;
    const p = world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    if (
      limit !== null &&
      terrain !== undefined &&
      !limit.allowsNode(terrain.nodeAtClamped(node.hx, node.hy))
    ) {
      continue;
    }
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (best === null || dist < best.dist) best = { entity: e, dist };
  }
  return best?.entity ?? null;
}
