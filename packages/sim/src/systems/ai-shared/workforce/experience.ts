import type { HumanJobExperienceType } from '@open-northland/data';
import { SettlerProgress } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { personalFightPoints } from '../../progression/bonus.js';
import { FIGHT_EXPERIENCE_TYPE, generalTrackFor, trackFor } from '../../progression/experience.js';
import { jobCanBuild } from '../../settlers/atomics/start.js';

/** The track a post of `jobType` trains: the `(job, good)` track when a good is given, else the job's
 *  general one. */
function postTrack(
  ctx: SystemContext,
  jobType: number,
  goodType: number | undefined,
): HumanJobExperienceType | undefined {
  return goodType === undefined ? generalTrackFor(ctx, jobType) : trackFor(ctx, jobType, goodType);
}

function experienceOn(world: World, e: Entity, track: HumanJobExperienceType | undefined): number {
  return track === undefined ? 0 : (world.get(e, SettlerProgress).experience.get(track.typeId) ?? 0);
}

/** The settler's raw experience on the track a post of `jobType` (gathering `goodType`) trains; 0 when
 *  the post trains no track. */
export function trackExperience(
  world: World,
  ctx: SystemContext,
  e: Entity,
  jobType: number,
  goodType?: number,
): number {
  return experienceOn(world, e, postTrack(ctx, jobType, goodType));
}

/** {@link trackExperience} as a rank for {@link SpareForce.take}, with the track resolved once. */
export function experienceRank(
  world: World,
  ctx: SystemContext,
  jobType: number,
  goodType?: number,
): (e: Entity) => number {
  const track = postTrack(ctx, jobType, goodType);
  return (e) => experienceOn(world, e, track);
}

/** The settler's raw experience summed over every track but the builder trade's: what the seat would
 *  waste by keeping him on the building sites. Buckets no content track backs (fight, scout) count too,
 *  the personal fight counter by its whole points. */
export function tradeExperience(world: World, ctx: SystemContext, e: Entity): number {
  const tracks = contentIndex(ctx.content).jobExperience;
  const experience = world.get(e, SettlerProgress).experience;
  let sum = 0;
  for (const [trackId, raw] of experience) {
    if (trackId === FIGHT_EXPERIENCE_TYPE.PERSONAL) {
      sum += personalFightPoints(experience);
      continue;
    }
    const track = tracks.get(trackId);
    if (track === undefined || !jobCanBuild(ctx.content, track.jobType)) sum += raw;
  }
  return sum;
}

/** Order `staff` most experienced first by `rank`, ascending entity id on ties, so a cap over the list
 *  keeps the veterans and the kept set never depends on iteration order. Sorts in place through reused
 *  scratch, since a library sort copies the list on every call. */
export function byExperience(staff: Entity[], rank: (e: Entity) => number): Entity[] {
  const n = staff.length;
  if (n < 2) return staff;
  const { ranks, entities, spareRanks, spareEntities } = sortScratch;
  for (let i = 0; i < n; i++) {
    const e = staff[i] as Entity;
    entities[i] = e;
    ranks[i] = rank(e);
  }
  // Bottom-up merge sort between the two scratch pairs; the comparison is a total order, so the result
  // matches any correct sort.
  let fromRanks = ranks;
  let fromEntities = entities;
  let toRanks = spareRanks;
  let toEntities = spareEntities;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let a = lo;
      let b = mid;
      for (let k = lo; k < hi; k++) {
        const takeA =
          b >= hi ||
          (a < mid &&
            ((fromRanks[a] as number) > (fromRanks[b] as number) ||
              ((fromRanks[a] as number) === (fromRanks[b] as number) &&
                (fromEntities[a] as Entity) < (fromEntities[b] as Entity))));
        const from = takeA ? a++ : b++;
        toRanks[k] = fromRanks[from] as number;
        toEntities[k] = fromEntities[from] as Entity;
      }
    }
    const ranksDone = fromRanks;
    fromRanks = toRanks;
    toRanks = ranksDone;
    const entitiesDone = fromEntities;
    fromEntities = toEntities;
    toEntities = entitiesDone;
  }
  for (let i = 0; i < n; i++) staff[i] = fromEntities[i] as Entity;
  return staff;
}

/** Scratch for {@link byExperience}, grown to the longest list sorted; only its first `n` slots mean
 *  anything during a call. */
const sortScratch = {
  ranks: [] as number[],
  entities: [] as Entity[],
  spareRanks: [] as number[],
  spareEntities: [] as Entity[],
};
