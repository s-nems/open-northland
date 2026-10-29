import type { ContentSet, JobRequirementTarget, TribeType } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';
import { SCHOOL_LESSON_TICKS } from '../../orders/education.js';
import { isFighterJob, isSchoolType } from '../../readviews/index.js';

/** The work that credits an experience track, read from the trade the track belongs to. `goods` empty
 *  means any work of that trade. */
export type CreditingWork =
  /** Gathering off the map, or off the fields one of `workshops` (employing the trade, producing one of
   *  `goods`) plants. */
  | { readonly kind: 'gather'; readonly goods: readonly number[]; readonly workshops: readonly number[] }
  | { readonly kind: 'hunt' }
  /** Workshop batches, in any building whose worker slots hold the trade. */
  | { readonly kind: 'craft'; readonly goods: readonly number[]; readonly workshops: readonly number[] }
  /** Work the computer player does not steer toward: deliveries, drills, fights. */
  | { readonly kind: 'other' };

/** One experience track a requirement row sums, with the trade that accrues it (`null` for a bucket no
 *  content track backs, such as the fight buckets) and the work that credits it. */
export interface CreditedTrack {
  readonly track: number;
  readonly job: number | null;
  readonly work: CreditingWork;
}

/** One `needfor*` row: `amount` repeats summed over `tracks`, all on one man. */
export interface NeedRow {
  readonly amount: number;
  readonly tracks: readonly CreditedTrack[];
}

/** What a school teaches of a discovered target: the lesson's length and the buildings that hold it. */
export interface SchoolCourse {
  readonly lessonTicks: number;
  readonly schools: readonly number[];
}

/**
 * How a job or good is first discovered. A gated job is discovered by a worker of one of its
 * `enablingJobs` (the `jobEnablesJob` edges into it) who meets every `needs` row; a gated good by a worker
 * of a producing trade (the `jobEnablesGood` edges) who meets its rows. A good with no row comes with its
 * producing trade, and a job with no row is open from the start, so both carry no `needs`.
 */
export interface DiscoveryGate {
  readonly kind: JobRequirementTarget;
  readonly typeId: number;
  readonly enablingJobs: readonly number[];
  readonly needs: readonly NeedRow[];
  /** The school course spreading it once discovered, or null when no `trainfor*` row teaches it. */
  readonly school: SchoolCourse | null;
}

/** The jobs and goods a house's technology row asks for, each with its gate. */
export interface BuildingRequirement {
  readonly house: number;
  readonly jobs: readonly DiscoveryGate[];
  readonly goods: readonly DiscoveryGate[];
}

/** One tribe's technology as the computer player reads it, derived from the tribe's requirement rows,
 *  `jobEnables*` edges and the content's experience tracks. */
export interface TechnologyTable {
  readonly houses: ReadonlyMap<number, BuildingRequirement>;
  readonly jobs: ReadonlyMap<number, DiscoveryGate>;
  readonly goods: ReadonlyMap<number, DiscoveryGate>;
}

const tables = new WeakMap<ContentSet, Map<number, TechnologyTable | null>>();

/** `tribe`'s {@link TechnologyTable}, memoized per content set; null for a tribe without a technology
 *  table, whose houses open along its trades instead. */
export function technologyTable(content: ContentSet, tribe: number): TechnologyTable | null {
  let byTribe = tables.get(content);
  if (byTribe === undefined) {
    byTribe = new Map();
    tables.set(content, byTribe);
  }
  if (byTribe.has(tribe)) return byTribe.get(tribe) ?? null;
  const definition = contentIndex(content).tribes.get(tribe);
  const table = definition?.technology === undefined ? null : buildTable(content, definition);
  byTribe.set(tribe, table);
  return table;
}

function buildTable(content: ContentSet, tribe: TribeType): TechnologyTable {
  const jobs = new Map<number, DiscoveryGate>();
  const goods = new Map<number, DiscoveryGate>();
  const gateOf = (kind: JobRequirementTarget, typeId: number): DiscoveryGate => {
    const known = (kind === 'job' ? jobs : goods).get(typeId);
    if (known !== undefined) return known;
    const gate = discoveryGate(content, tribe, kind, typeId);
    (kind === 'job' ? jobs : goods).set(typeId, gate);
    return gate;
  };
  for (const row of tribe.jobRequirements) gateOf(row.target, row.targetId);
  for (const edge of tribe.jobEnables) {
    if (edge.kind === 'job' || edge.kind === 'good') gateOf(edge.kind, edge.targetId);
  }
  const houses = new Map<number, BuildingRequirement>();
  for (const row of tribe.technology?.houses ?? []) {
    houses.set(row.house, {
      house: row.house,
      jobs: row.jobs.map((id) => gateOf('job', id)),
      goods: row.goods.map((id) => gateOf('good', id)),
    });
  }
  return { houses, jobs, goods };
}

function discoveryGate(
  content: ContentSet,
  tribe: TribeType,
  kind: JobRequirementTarget,
  typeId: number,
): DiscoveryGate {
  const enablingJobs: number[] = [];
  for (const edge of tribe.jobEnables) {
    if (edge.kind === kind && edge.targetId === typeId && !enablingJobs.includes(edge.jobType))
      enablingJobs.push(edge.jobType);
  }
  enablingJobs.sort((a, b) => a - b);
  const needs: NeedRow[] = [];
  let lessonAmount = -1;
  for (const row of tribe.jobRequirements) {
    if (row.target !== kind || row.targetId !== typeId) continue;
    if (row.requirement === 'train') lessonAmount = Math.max(lessonAmount, row.amount);
    else if (row.amount > 0 && row.experienceTypes.length > 0)
      needs.push({ amount: row.amount, tracks: row.experienceTypes.map((id) => creditedTrack(content, id)) });
  }
  // The school refuses a fighter trade: the barracks drill is its only door.
  const taught = lessonAmount >= 0 && !(kind === 'job' && isFighterJob(content, typeId));
  return {
    kind,
    typeId,
    enablingJobs,
    needs,
    school: taught
      ? { lessonTicks: lessonAmount * SCHOOL_LESSON_TICKS, schools: schoolTypes(content) }
      : null,
  };
}

function creditedTrack(content: ContentSet, trackId: number): CreditedTrack {
  const index = contentIndex(content);
  const track = index.jobExperience.get(trackId);
  if (track === undefined) return { track: trackId, job: null, work: { kind: 'other' } };
  const job = track.jobType;
  if (index.hunterJobs.has(job)) return { track: trackId, job, work: { kind: 'hunt' } };
  const workshops = content.buildings
    .filter((b) => b.workers.some((slot) => slot.jobType === job))
    .map((b) => b.typeId);
  if (index.harvestJobs.has(job)) {
    const goods = track.goodTypes;
    const growers = workshops.filter((id) =>
      (index.buildings.get(id)?.produces ?? []).some((g) => goods.length === 0 || goods.includes(g)),
    );
    return { track: trackId, job, work: { kind: 'gather', goods, workshops: growers } };
  }
  if (workshops.length === 0) return { track: trackId, job, work: { kind: 'other' } };
  return { track: trackId, job, work: { kind: 'craft', goods: track.goodTypes, workshops } };
}

function schoolTypes(content: ContentSet): number[] {
  return content.buildings.filter((b) => isSchoolType(b)).map((b) => b.typeId);
}
