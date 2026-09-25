import type { HumanJobExperienceType } from '@open-northland/data';
import { SettlerProgress } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { generalTrackFor, trackFor } from '../../progression/experience.js';
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
 *  waste by keeping him on the building sites. Buckets no content track backs (fight, scout) count too. */
export function tradeExperience(world: World, ctx: SystemContext, e: Entity): number {
  const tracks = contentIndex(ctx.content).jobExperience;
  let sum = 0;
  for (const [trackId, points] of world.get(e, SettlerProgress).experience) {
    const track = tracks.get(trackId);
    if (track === undefined || !jobCanBuild(ctx.content, track.jobType)) sum += points;
  }
  return sum;
}

/** Order `staff` most experienced first by `rank`, ascending entity id on ties, so a cap over the list
 *  keeps the veterans and the kept set never depends on iteration order. */
export function byExperience(staff: Entity[], rank: (e: Entity) => number): Entity[] {
  const ranks = new Map(staff.map((e) => [e, rank(e)]));
  return staff.sort((a, b) => (ranks.get(b) ?? 0) - (ranks.get(a) ?? 0) || a - b);
}
