import type { ContentSet } from '@open-northland/data';
import {
  Age,
  Female,
  JobAssignment,
  Marriage,
  ownerOf,
  Person,
  Position,
  Residence,
  Settler,
  TrainingOrder,
  Wedding,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { MapContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { isNonWorkingAge } from '../lifecycle/ageclass.js';
import { isFighterJob, isScoutJob } from '../readviews/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import { settlementReachAt } from '../signposts/settlement-reach.js';
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
 * Whether a settler of `jobType` is away on a mission, a fighter or the scout: it does not marry, and
 * reverting to a civilian trade lets it again. Authored, over the content-derived job roles. Whether it
 * comes home is the data's own flag (`homeUsedBy`).
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

/** Whether `e` is neither {@link isMarried} nor walking to a wedding. */
export function isUnwed(world: World, e: Entity): boolean {
  return !world.has(e, Wedding) && !isMarried(world, e);
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
 * under signpost navigation a partner outside the seeker's allowed area is not eligible. Original
 * behavior: only the seeker's own player's humans of its tribe are candidates. Approximation: the
 * whole-map nearest pick; the original searches a bounded area around the seeker.
 *
 * Our own rule: both partners belong to the settlement where the seeker stands ({@link settlementReachAt}),
 * so a man passing through, such as a ship's hand ashore at another island, is not wed into a household
 * across water, and a seeker away from her own settlement weds no one there.
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
  const owner = ownerOf(world, seeker);
  const seekerFemale = world.has(seeker, Female);
  const settlement =
    terrain === undefined || owner === undefined
      ? null
      : settlementOf(world, { content, terrain }, terrain, owner, from);
  if (settlement !== null && !settlement.holds(seeker)) return null;
  let best: { entity: Entity; dist: number } | null = null;
  for (const e of world.canonicalQuery(Person, Position)) {
    if (e === seeker || !mayMarry(world, content, e)) continue;
    if (world.get(e, Settler).tribe !== tribe || ownerOf(world, e) !== owner) continue;
    if (world.has(e, Female) === seekerFemale) continue;
    const p = world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (best !== null && dist >= best.dist) continue;
    if (
      limit !== null &&
      terrain !== undefined &&
      !limit.allowsNode(terrain.nodeAtClamped(node.hx, node.hy))
    ) {
      continue;
    }
    if (settlement !== null && !settlement.holds(e)) continue;
    best = { entity: e, dist };
  }
  return best?.entity ?? null;
}

/** The settlement `player` holds around `from`, as a test of who belongs to it: a settler standing inside
 *  whose home and workplace, where it has them, stand inside too. */
function settlementOf(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  player: number,
  from: { hx: number; hy: number },
): { holds(e: Entity): boolean } {
  const reach = settlementReachAt(
    world,
    ctx.content,
    terrain,
    player,
    terrain.nodeAtClamped(from.hx, from.hy),
  );
  const inside = (building: Entity | undefined): boolean => {
    if (building === undefined || !world.isAlive(building)) return true;
    const door = interactionNodeId(world, ctx, terrain, building);
    return door === null || reach.allowsNode(door);
  };
  return {
    holds: (e) => {
      const p = world.get(e, Position);
      const node = nodeOfPosition(p.x, p.y);
      return (
        reach.allowsNode(terrain.nodeAtClamped(node.hx, node.hy)) &&
        inside(world.tryGet(e, Residence)?.home) &&
        inside(world.tryGet(e, JobAssignment)?.workplace)
      );
    },
  };
}
