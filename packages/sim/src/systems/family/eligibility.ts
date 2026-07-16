import { Age, Female, Marriage, Position, Settler, Wedding } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { isNonWorkingAge } from '../lifecycle/ageclass.js';
import { isFighterJob, SCOUT_JOB } from '../readviews/stances.js';
import { canonicalById } from '../spatial.js';

// Who may marry, and how a partner is picked — the pure predicates behind the `marry` command and the
// FamilySystem's activity gates.

/**
 * The job `id` slugs that carry the female sex in the source data (`jobtypes.ini` — the sex-tagged
 * age classes and the adult woman role). Matched by slug, not numeric id: a synthetic fixture may
 * reuse a low numeric id for an adult trade (the goldens' woodcutter is jobType 1), and a slug can't
 * collide that way.
 */
const FEMALE_JOB_IDS: ReadonlySet<string> = new Set(['baby_female', 'child_female', 'woman']);

/** Whether a job slug marks its holder female at spawn (see {@link FEMALE_JOB_IDS}). */
export function isFemaleJobId(id: string | undefined): boolean {
  return id !== undefined && FEMALE_JOB_IDS.has(id);
}

/**
 * Whether a settler of `jobType` is away on a mission — a soldier/hero (the fighter band) or the scout.
 * Such a settler neither marries nor comes home to its family (the wife does not wait for it); reverting
 * to any civilian trade restores family life. Source basis: user-specified design over the pinned job-id
 * bands ({@link isFighterJob}/{@link SCOUT_JOB}).
 */
export function isOnMission(jobType: number | null): boolean {
  return isFighterJob(jobType) || jobType === SCOUT_JOB;
}

/** Whether `e` is a grown settler: not carrying an {@link Age} (born-young marker) and not in a
 *  non-working age-class job. Children neither marry nor live independently. */
export function isAdultSettler(world: World, e: Entity): boolean {
  if (world.has(e, Age)) return false;
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && !isNonWorkingAge(settler.jobType);
}

/** Whether `e` may enter a marriage right now: a living adult settler, unmarried, not mid-wedding, and
 *  not away on a mission ({@link isOnMission}). */
export function mayMarry(world: World, e: Entity): boolean {
  if (!world.isAlive(e) || !isAdultSettler(world, e)) return false;
  if (world.has(e, Marriage) || world.has(e, Wedding)) return false;
  return !isOnMission(world.get(e, Settler).jobType);
}

/**
 * The nearest eligible partner for `seeker`, or null when none exists (the marry order then auto-cancels).
 * Eligible: {@link mayMarry}, the seeker's tribe, the opposite sex, positioned. Nearest by half-cell
 * Manhattan distance from the seeker with the ascending-entity-id tie-break — a canonical pick over the
 * ascending-id candidate scan, so the winner never depends on store insertion order.
 */
export function findPartnerFor(world: World, seeker: Entity): Entity | null {
  const seekerPos = world.tryGet(seeker, Position);
  if (seekerPos === undefined) return null;
  const from = nodeOfPosition(seekerPos.x, seekerPos.y);
  const tribe = world.get(seeker, Settler).tribe;
  const seekerFemale = world.has(seeker, Female);
  let best: { entity: Entity; dist: number } | null = null;
  for (const e of canonicalById(world.query(Settler, Position))) {
    if (e === seeker || !mayMarry(world, e)) continue;
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (world.has(e, Female) === seekerFemale) continue; // same sex — a couple is a woman and a man
    const p = world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    const dist = Math.abs(node.hx - from.hx) + Math.abs(node.hy - from.hy);
    if (best === null || dist < best.dist) best = { entity: e, dist };
  }
  return best?.entity ?? null;
}
