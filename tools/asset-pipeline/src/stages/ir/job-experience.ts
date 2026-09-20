import type { HumanJobExperienceType, TribeType } from '@open-northland/data';
import { slug } from '../../decoders/ini.js';

/** Professions and goods the corrections below name, from `jobtypes.ini` and `goodtypes.ini`. */
const JOB = { CARPENTER: 9, ARMORER: 10, SMITH: 13, HERBALIST: 29 } as const;
const GOOD = { MUSHROOM: 14, IRON_TOOL: 32, WOODEN_SPEAR: 39, CATAPULT: 63 } as const;

interface JobExperienceCorrection {
  /** The record as the mod ships it. A row that stops matching is skipped, so a mod revision that
   *  fixes the file is converted as written instead of being re-pointed against its new intent. */
  readonly shipped: {
    readonly typeId: number;
    readonly jobType: number;
    readonly goodTypes: readonly number[];
  };
  /** The profession that really makes the goods, and the record's corrected name; omitted to drop the
   *  record entirely. */
  readonly corrected?: { readonly jobType: number; readonly name: string };
}

/**
 * Records CulturesNation left on a profession that no longer makes their good, and the one the
 * collector's own record superseded. `docs/formats/PROGRESSION.md` holds the evidence and the
 * consequence of shipping them as written.
 */
const CULTURESNATION_CORRECTIONS: readonly JobExperienceCorrection[] = [
  {
    shipped: { typeId: 29, jobType: JOB.SMITH, goodTypes: [GOOD.IRON_TOOL] },
    corrected: { jobType: JOB.CARPENTER, name: 'carpenter iron tool' },
  },
  {
    shipped: { typeId: 20, jobType: JOB.ARMORER, goodTypes: [GOOD.CATAPULT] },
    corrected: { jobType: JOB.CARPENTER, name: 'carpenter catapult' },
  },
  {
    shipped: { typeId: 12, jobType: JOB.CARPENTER, goodTypes: [GOOD.WOODEN_SPEAR] },
    corrected: { jobType: JOB.ARMORER, name: 'armorer wooden spear' },
  },
  // Dropped, not re-owned: the collector's own `collector mushroom` already specializes the pairing
  // this record would move onto, and no requirement row names type 55.
  { shipped: { typeId: 55, jobType: JOB.HERBALIST, goodTypes: [GOOD.MUSHROOM] } },
];

/**
 * The experience table as the runtime should read it: the corrections above applied, then every
 * surviving specialization checked against the professions the tribes actually enable its goods for.
 * A record the corrections do not cover and the tribe table contradicts fails the build.
 */
export function correctJobExperience(
  tracks: readonly HumanJobExperienceType[],
  tribes: readonly TribeType[],
): HumanJobExperienceType[] {
  const corrected = applyCorrections(tracks);
  assertSpecializationsAreConsistent(corrected, tribes);
  return corrected;
}

function applyCorrections(tracks: readonly HumanJobExperienceType[]): HumanJobExperienceType[] {
  const out: HumanJobExperienceType[] = [];
  for (const track of tracks) {
    const row = CULTURESNATION_CORRECTIONS.find(({ shipped }) => matchesShipped(shipped, track));
    if (row === undefined) {
      out.push(track);
      continue;
    }
    if (row.corrected === undefined) continue;
    const { jobType, name } = row.corrected;
    out.push({ ...track, jobType, name, id: slug(name) });
  }
  return out;
}

function matchesShipped(shipped: JobExperienceCorrection['shipped'], track: HumanJobExperienceType): boolean {
  return (
    shipped.typeId === track.typeId &&
    shipped.jobType === track.jobType &&
    shipped.goodTypes.length === track.goodTypes.length &&
    shipped.goodTypes.every((good, i) => good === track.goodTypes[i])
  );
}

/** Every job each tribe's `jobEnablesGood` edges name as making a good, unioned across tribes: fish
 *  really does have two owners (fisher and sea fisher). */
function producersByGood(tribes: readonly TribeType[]): Map<number, Set<number>> {
  const producers = new Map<number, Set<number>>();
  for (const tribe of tribes) {
    for (const edge of tribe.jobEnables) {
      if (edge.kind !== 'good') continue;
      const jobs = producers.get(edge.targetId) ?? new Set<number>();
      jobs.add(edge.jobType);
      producers.set(edge.targetId, jobs);
    }
  }
  return producers;
}

function assertSpecializationsAreConsistent(
  tracks: readonly HumanJobExperienceType[],
  tribes: readonly TribeType[],
): void {
  const producers = producersByGood(tribes);
  // A partial mod tree may resolve the experience table without the tribe table; there is then nothing
  // to compare an owner against, and `resolveIniSources` promises such a run still yields an IR.
  const ownersAreKnown = producers.size > 0;
  const problems: string[] = [];
  const ownerOfPairing = new Map<string, number>();
  for (const track of tracks) {
    for (const good of track.goodTypes) {
      const jobs = producers.get(good);
      if (ownersAreKnown && (jobs === undefined || !jobs.has(track.jobType))) {
        const owners = [...(jobs ?? [])].sort((a, b) => a - b);
        problems.push(
          `"${track.id}" (type ${track.typeId}) specializes job ${track.jobType} on good ${good}, ` +
            (owners.length === 0
              ? 'which no jobEnablesGood row enables'
              : `which only job ${owners.join('/')} enables`),
        );
      }
      const pairing = `${track.jobType}:${good}`;
      const owner = ownerOfPairing.get(pairing);
      if (owner === undefined) ownerOfPairing.set(pairing, track.typeId);
      else {
        // `trackFor` would resolve the pairing by table position, so two records may never claim it.
        problems.push(
          `"${track.id}" (type ${track.typeId}) repeats the job ${track.jobType} / good ${good} ` +
            `specialization type ${owner} already owns`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`ir: job experience records are inconsistent:\n  ${problems.join('\n  ')}`);
  }
}
