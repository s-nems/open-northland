import {
  HumanJobExperienceType,
  type JobEnables,
  type JobEnablesKind,
  type JobRequirement,
  type JobRequirementKind,
  type JobRequirementTarget,
  JobType,
  TribeType,
} from '@open-northland/data';
import type { RuleSection } from '../grammar.js';
import { makeSource, requireTypeId, type SourceRef, slug } from '../ir-fields.js';
import { findProps, getInt, getIntList, getStr } from '../props.js';

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
        baseJob: getInt(sec, 'baseatomics'),
        forbiddenAtomics: getIntList(sec, 'forbidatomic'),
        needsReligion: getInt(sec, 'needsReligionFlag') === 1,
        ignoresHomeHouse: getInt(sec, 'ignoresHomeHouseFlag') === 1,
        source: makeSource(src, 'jobtype'),
      }),
    );
  }
  return jobs;
}

/** A track always names its owning `job`, so a record without one throws. */
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

const JOB_ENABLES_KIND: Readonly<Record<string, JobEnablesKind>> = {
  jobEnablesGood: 'good',
  jobEnablesHouse: 'house',
  jobEnablesJob: 'job',
  jobEnablesVehicle: 'vehicle',
};

/** The four kinds interleave within a job's block, so one file-order pass keeps the source order. */
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

const JOB_REQUIREMENT_KEY: Readonly<
  Record<string, { requirement: JobRequirementKind; target: JobRequirementTarget }>
> = {
  needforjob: { requirement: 'need', target: 'job' },
  needforgood: { requirement: 'need', target: 'good' },
  trainforjob: { requirement: 'train', target: 'job' },
  trainforgood: { requirement: 'train', target: 'good' },
};

/** A line with no experience-type id still yields a record; only a missing target or amount skips it. */
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

/** The readable mod `tribetypes.ini` covers the playable tribes and the animal tribes alike. */
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
        permissions: {
          job: getIntList(sec, 'allowjob'),
          house: getIntList(sec, 'allowhouse'),
          good: getIntList(sec, 'allowgood'),
        },
        jobEnables: extractJobEnables(sec),
        jobRequirements: extractJobRequirements(sec),
        source: makeSource(src, 'tribetype'),
      }),
    );
  }
  return tribes;
}
