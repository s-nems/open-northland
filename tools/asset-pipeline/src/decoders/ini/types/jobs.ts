/**
 * Jobs, human job-experience types, and the tribe tech-graph (job-enable and job-requirement decomposition).
 */
import {
  HumanJobExperienceType,
  type JobEnables,
  type JobEnablesKind,
  type JobRequirement,
  type JobRequirementKind,
  type JobRequirementTarget,
  JobType,
  TribeType,
} from '@vinland/data';
import {
  findProps,
  getInt,
  getIntList,
  getStr,
  makeSource,
  type RuleSection,
  requireTypeId,
  type SourceRef,
  slug,
} from '../grammar.js';

/**
 * Extracts `[jobtype]` sections into validated {@link JobType} IR, capturing the atomic vocabulary a
 * job may perform: `allowatomic` (granted), `baseatomics` (always-available base set) and
 * `forbidatomic` (hard-denied) — all repeated single-value lines kept in file order. The Phase-2
 * atomic planner picks among these.
 */
export function extractJobs(sections: readonly RuleSection[], src: SourceRef): JobType[] {
  const jobs: JobType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'jobtype') continue;
    const typeId = requireTypeId(sec, 'jobtype', src);
    const name = getStr(sec, 'name');
    jobs.push(
      JobType.parse({
        typeId,
        id: name ? slug(name) : `job_${typeId}`,
        name,
        allowedAtomics: getIntList(sec, 'allowatomic'),
        baseAtomics: getIntList(sec, 'baseatomics'),
        forbiddenAtomics: getIntList(sec, 'forbidatomic'),
        source: makeSource(src, 'jobtype'),
      }),
    );
  }
  return jobs;
}

/**
 * Extracts `[humanjobexperiencetype]` sections (`Data/logic/humanjobexperiencetypes.ini`) into
 * validated {@link HumanJobExperienceType} IR — the per-specialization experience tracks the Phase-3
 * ProgressionSystem accrues XP into. A track names its owning `job` (always) and, when good-specific,
 * the `good` it trains on; `experiencefactor` scales accrual and `baserepeatcounter` (on a few records)
 * is the original's repeat-count tuning. The numeric semantics are captured raw — interpreting the XP
 * curve is the ProgressionSystem's concern, not this extraction slice. The `job`/`good` ids are
 * cross-checked against the job/good tables by `validateCrossReferences`. Throws on a record missing
 * the required numeric `type` id (matches {@link extractGoods}'s throw-on-malformed stance). The base
 * `.ini` is the source — there is no mod twin and no readable-vs-encrypted choice to make here.
 */
export function extractJobExperience(
  sections: readonly RuleSection[],
  src: SourceRef,
): HumanJobExperienceType[] {
  const tracks: HumanJobExperienceType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'humanjobexperiencetype') continue;
    const typeId = requireTypeId(sec, 'humanjobexperiencetype', src);
    const name = getStr(sec, 'name');
    const jobType = getInt(sec, 'job');
    if (jobType === undefined) {
      throw new Error(`ini: [humanjobexperiencetype] without a numeric \`job\` in ${src.file}`);
    }
    tracks.push(
      HumanJobExperienceType.parse({
        typeId,
        id: name ? slug(name) : `jobxp_${typeId}`,
        name,
        jobType,
        goodType: getInt(sec, 'good'),
        experienceFactor: getInt(sec, 'experiencefactor') ?? 0,
        baseRepeatCounter: getInt(sec, 'baserepeatcounter'),
        source: makeSource(src, 'humanjobexperiencetype'),
      }),
    );
  }
  return tracks;
}

/** The four `jobEnables<Kind>` source keys → the unified {@link JobEnables} `kind` discriminator. */
const JOB_ENABLES_KIND: Readonly<Record<string, JobEnablesKind>> = {
  jobEnablesGood: 'good',
  jobEnablesHouse: 'house',
  jobEnablesJob: 'job',
  jobEnablesVehicle: 'vehicle',
};

/**
 * Collects one `[tribetype]` section's `jobEnables<Kind> <jobType> <targetId>` lines into unified
 * {@link JobEnables} tech-graph edges in **exact source order**. The real data interleaves the four
 * kinds within a job's block (e.g. job 8's goods, then its jobs, then its houses), so a single
 * file-order pass — recognizing any of the four keys — keeps that order verbatim rather than
 * regrouping by kind. A line missing either int is skipped, matching the `setatomic` malformed-line
 * stance. (A non-`jobEnables*` prop yields no key match and is ignored.)
 */
function extractJobEnables(sec: RuleSection): JobEnables[] {
  const edges: JobEnables[] = [];
  for (const p of sec.props) {
    const kind = JOB_ENABLES_KIND[p.key];
    if (kind === undefined) continue;
    const jobType = Number.parseInt(p.values[0] ?? '', 10);
    const targetId = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(jobType) || Number.isNaN(targetId)) continue;
    edges.push({ jobType, kind, targetId });
  }
  return edges;
}

/** The four `{need,train}for{job,good}` source keys → their (requirement, target) decomposition. */
const JOB_REQUIREMENT_KEY: Readonly<
  Record<string, { requirement: JobRequirementKind; target: JobRequirementTarget }>
> = {
  needforjob: { requirement: 'need', target: 'job' },
  needforgood: { requirement: 'need', target: 'good' },
  trainforjob: { requirement: 'train', target: 'job' },
  trainforgood: { requirement: 'train', target: 'good' },
};

/**
 * Collects one `[tribetype]` section's `{need,train}for{job,good} <targetId> <amount> <expType>
 * [expType2]` lines into unified {@link JobRequirement} records in **exact source order** (the data
 * interleaves `need`/`train` blocks, kept verbatim like {@link JobEnables}). The `need`/`train`
 * prefix and `job`/`good` suffix of the key give the two dimensions; the remaining ints are the
 * target id, the amount, and one-or-two experience-type ids. A line missing the target id or the
 * amount is skipped, matching the `setatomic`/`jobEnables` malformed-line stance; a line with no
 * expType still yields a record (`experienceTypes: []`) rather than being dropped.
 */
function extractJobRequirements(sec: RuleSection): JobRequirement[] {
  const reqs: JobRequirement[] = [];
  for (const p of sec.props) {
    const decomposed = JOB_REQUIREMENT_KEY[p.key];
    if (decomposed === undefined) continue;
    const targetId = Number.parseInt(p.values[0] ?? '', 10);
    const amount = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(targetId) || Number.isNaN(amount)) continue;
    const experienceTypes: number[] = [];
    for (const raw of p.values.slice(2)) {
      const expType = Number.parseInt(raw, 10);
      if (!Number.isNaN(expType)) experienceTypes.push(expType);
    }
    reqs.push({ ...decomposed, targetId, amount, experienceTypes });
  }
  return reqs;
}

/**
 * Extracts `[tribetype]` sections into validated {@link TribeType} IR. The payload is each tribe's
 * `setatomic <jobType> <atomicId> "animation"` bindings — the per-tribe atomic→animation table that
 * carries tribal identity — plus its `jobEnables*` tech-graph edges ({@link extractJobEnables}) and
 * its `{need,train}for*` experience requirements ({@link extractJobRequirements}). The readable mod
 * `tribetypes.ini` covers playable tribes AND animals. Malformed `setatomic` lines (missing the
 * job/atomic ints or the animation token) are skipped.
 */
export function extractTribes(sections: readonly RuleSection[], src: SourceRef): TribeType[] {
  const tribes: TribeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'tribetype') continue;
    const typeId = requireTypeId(sec, 'tribetype', src);
    const name = getStr(sec, 'name');
    const atomicBindings: { jobType: number; atomicId: number; animation: string }[] = [];
    for (const p of findProps(sec, 'setatomic')) {
      const jobType = Number.parseInt(p.values[0] ?? '', 10);
      const atomicId = Number.parseInt(p.values[1] ?? '', 10);
      const animation = p.values[2];
      if (Number.isNaN(jobType) || Number.isNaN(atomicId) || animation === undefined) continue;
      atomicBindings.push({ jobType, atomicId, animation });
    }
    tribes.push(
      TribeType.parse({
        typeId,
        id: name ? slug(name) : `tribe_${typeId}`,
        name,
        atomicBindings,
        jobEnables: extractJobEnables(sec),
        jobRequirements: extractJobRequirements(sec),
        source: makeSource(src, 'tribetype'),
      }),
    );
  }
  return tribes;
}
