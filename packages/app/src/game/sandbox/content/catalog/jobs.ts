import {
  ATTACK_ATOMIC,
  BUILD_GUIDE_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  BUILD_WALL_ATOMIC,
  CULTIVATE_ATOMIC,
  FISH_CAST_ATOMIC,
  FISH_CAUGHT_ATOMIC,
  FISH_FAILED_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  PLANT_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { PRODUCE_ATOMIC_BY_GOOD_ID, SLAY_ATOMIC_BY_GOOD_ID } from '../../../../catalog/goods.js';
import {
  HOMELESS_JOBS,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BABY_FEMALE,
  JOB_BABY_MALE,
  JOB_BREEDER,
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_FISHER,
  JOB_HUNTER,
  JOB_IDLE,
  JOB_JOINER,
  JOB_SCOUT,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
  RELIGION_JOBS,
} from '../../../../catalog/jobs.js';
import { PROFESSIONS } from '../../../../catalog/professions.js';
import { messages, professionLabel } from '../../../../i18n/index.js';
import {
  EXTRACTED_GATHERER_TRADES,
  GATHERERS,
  JOB_FARMER_SLOT,
  JOB_VEHICLE_CATAPULT,
  rebaseSlotJob,
} from '../../ids/index.js';
import { BUILDING_WORKER_SLOTS, workerSlotName } from '../../worker-slots.js';
import type { SandboxContentExtras } from '../types.js';

export interface SandboxJob {
  readonly typeId: number;
  readonly id: string;
  readonly name?: string;
  readonly allowedAtomics?: number[];
  /** `jobtypes.ini` `needsReligionFlag` / `ignoresHomeHouseFlag`, stamped from the catalog's own sets. */
  readonly needsReligion?: boolean;
  readonly ignoresHomeHouse?: boolean;
}

/** Extracted `jobtypes.ini` 15 `allowatomic 33/81`; the rebase-exempt hunter slot shares it by identity. */
const HUNTER_JOB_ATOMICS = [HARVEST_CADAVER_ATOMIC, ATTACK_ATOMIC];

export function buildSandboxJobs(extras: SandboxContentExtras): Map<number, SandboxJob> {
  const jobs = new Map<number, SandboxJob>();
  for (const job of [
    { typeId: JOB_IDLE, id: 'idle', name: professionLabel('idle') },
    // Sex is stamped from these slugs at spawn, and a girl matures into `woman`.
    { typeId: JOB_BABY_FEMALE, id: 'baby_female' },
    { typeId: JOB_BABY_MALE, id: 'baby_male' },
    { typeId: JOB_CHILD_FEMALE, id: 'child_female' },
    { typeId: JOB_CHILD_MALE, id: 'child_male' },
    { typeId: JOB_WOMAN, id: 'woman' },
    { typeId: JOB_CIVILIST, id: 'civilist' },
    // One trade on every harvest atomic, because the original's single collector fells, mines and picks.
    {
      typeId: JOB_COLLECTOR,
      id: 'collector',
      name: professionLabel('collector'),
      allowedAtomics: GATHERERS.map((gatherer) => gatherer.atomic),
    },
    { typeId: JOB_CARRIER, id: 'carrier', name: professionLabel('carrier') },
    // Extracted `jobtypes.ini` 9 `allowatomic 39`: the joiner swings the build-house action on the
    // yard site of a vehicle it makes.
    {
      typeId: JOB_JOINER,
      id: 'joiner',
      name: professionLabel('joiner'),
      allowedAtomics: [BUILD_HOUSE_ATOMIC],
    },
    // Extracted `jobtypes.ini` 27 `allowatomic 43`, the signpost-erecting swing.
    {
      typeId: JOB_SCOUT,
      id: 'scout',
      name: professionLabel('scout'),
      allowedAtomics: [BUILD_GUIDE_ATOMIC],
    },
    {
      typeId: JOB_HUNTER,
      id: 'hunter',
      name: professionLabel('hunter'),
      allowedAtomics: HUNTER_JOB_ATOMICS,
    },
    {
      typeId: JOB_FISHER,
      id: 'fisher',
      name: professionLabel('fisher'),
      allowedAtomics: [FISH_CAST_ATOMIC, FISH_CAUGHT_ATOMIC, FISH_FAILED_ATOMIC],
    },
    {
      typeId: JOB_FARMER_SLOT,
      id: 'farmer',
      name: professionLabel('farmer'),
      allowedAtomics: [WHEAT_HARVEST_ATOMIC, PLANT_ATOMIC, CULTIVATE_ATOMIC],
    },
    { typeId: JOB_SOLDIER_UNARMED, id: 'soldier_unarmed', name: messages().admin.units.unarmed },
    {
      typeId: JOB_BUILDER,
      id: 'builder',
      name: professionLabel('builder'),
      allowedAtomics: [BUILD_HOUSE_ATOMIC, BUILD_WALL_ATOMIC],
    },
    { typeId: JOB_SOLDIER_SPEAR, id: 'soldier_spear', name: messages().admin.units.spear },
    { typeId: JOB_SOLDIER_SWORD, id: 'soldier_sword', name: messages().admin.units.sword },
    { typeId: JOB_SOLDIER_BROADSWORD, id: 'soldier_broadsword', name: messages().admin.units.broadsword },
    { typeId: JOB_ARCHER, id: 'soldier_bow', name: messages().admin.units.bow },
    { typeId: JOB_ARCHER_LONG, id: 'soldier_bow_long', name: messages().admin.units.longbow },
    // Extracted `jobtypes.ini` 54: the catapult's own trade, which its weapon row binds to. Nobody
    // takes it; it is the vehicle's key.
    { typeId: JOB_VEHICLE_CATAPULT, id: 'vehicle_catapult', allowedAtomics: [ATTACK_ATOMIC] },
  ]) {
    jobs.set(job.typeId, job);
  }
  for (const profession of PROFESSIONS) {
    if (!jobs.has(profession.jobType)) {
      jobs.set(profession.jobType, { typeId: profession.jobType, id: profession.key });
    }
  }
  // Shared with the ordinary gatherer worker-slot trades below. The fisher is already declared above
  // with its dedicated shore-work atomics.
  const gathererAtomics = GATHERERS.map((gatherer) => gatherer.atomic);
  // The breeder's slot is a real trade too: breeding an animal of a species and slaughtering one are the
  // actions its whole cycle hangs on (`jobtypes.ini` breeder `allowatomic 85..88`).
  const breederAtomics = Object.keys(SLAY_ATOMIC_BY_GOOD_ID).flatMap((species) =>
    [PRODUCE_ATOMIC_BY_GOOD_ID[species], SLAY_ATOMIC_BY_GOOD_ID[species]].filter(
      (atomic): atomic is number => atomic !== undefined,
    ),
  );
  for (const slots of Object.values(BUILDING_WORKER_SLOTS)) {
    for (const worker of slots) {
      const jobType = rebaseSlotJob(worker.jobType);
      if (!jobs.has(jobType)) {
        const job: SandboxJob = {
          typeId: jobType,
          id: `worker_${jobType}`,
          name: workerSlotName(worker.jobType),
        };
        // A gatherer slot is a real harvest trade: it works a raw good on the map and delivers into its
        // building, so it needs the harvest atomics.
        if (EXTRACTED_GATHERER_TRADES.has(worker.jobType)) {
          jobs.set(jobType, { ...job, allowedAtomics: gathererAtomics });
        } else if (worker.jobType === JOB_BREEDER) {
          jobs.set(jobType, { ...job, allowedAtomics: breederAtomics });
        } else jobs.set(jobType, job);
      }
    }
  }
  for (const job of extras.jobs ?? []) {
    if (!jobs.has(job.typeId)) jobs.set(job.typeId, job);
  }
  // The two `jobtypes.ini` flags the needs rules read, stamped last so every row above gets them.
  for (const [typeId, job] of jobs) {
    const needsReligion = RELIGION_JOBS.has(typeId);
    const ignoresHomeHouse = HOMELESS_JOBS.has(typeId);
    if (needsReligion || ignoresHomeHouse) jobs.set(typeId, { ...job, needsReligion, ignoresHomeHouse });
  }
  return jobs;
}
