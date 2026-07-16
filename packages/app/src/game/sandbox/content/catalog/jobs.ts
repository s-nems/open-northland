import {
  BUILD_GUIDE_ATOMIC,
  CULTIVATE_ATOMIC,
  PLANT_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { PROFESSIONS } from '../../../../catalog/professions.js';
import { messages, professionLabel } from '../../../../i18n/index.js';
import {
  BUILD_HOUSE_ATOMIC,
  EXTRACTED_GATHERER_TRADES,
  GATHERERS,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BABY_FEMALE,
  JOB_BABY_MALE,
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_FARMER_SLOT,
  JOB_IDLE,
  JOB_SCOUT,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
  rebaseSlotJob,
} from '../../ids/index.js';
import { BUILDING_WORKER_SLOTS, workerSlotName } from '../../worker-slots.js';
import type { SandboxContentExtras } from '../types.js';

export interface SandboxJob {
  readonly typeId: number;
  readonly id: string;
  readonly name?: string;
  readonly allowedAtomics?: number[];
}

/** Build every functional, picker and worker-slot job the sandbox content references. */
export function buildSandboxJobs(extras: SandboxContentExtras): Map<number, SandboxJob> {
  const jobs = new Map<number, SandboxJob>();
  for (const job of [
    { typeId: JOB_IDLE, id: 'idle', name: professionLabel('idle') },
    // The life-stage classes + the two generic adults (`jobtypes.ini` 1..6): the family mechanics'
    // vocabulary — sex is stamped from these slugs at spawn and a girl matures into `woman`.
    { typeId: JOB_BABY_FEMALE, id: 'baby_female' },
    { typeId: JOB_BABY_MALE, id: 'baby_male' },
    { typeId: JOB_CHILD_FEMALE, id: 'child_female' },
    { typeId: JOB_CHILD_MALE, id: 'child_male' },
    { typeId: JOB_WOMAN, id: 'woman' },
    { typeId: JOB_CIVILIST, id: 'civilist' },
    // One collector trade allowed on every gathered good's harvest atomic (the original's single
    // collector fells, mines, and picks) — see {@link GATHERERS}.
    {
      typeId: JOB_COLLECTOR,
      id: 'collector',
      name: professionLabel('collector'),
      allowedAtomics: GATHERERS.map((gatherer) => gatherer.atomic),
    },
    { typeId: JOB_CARRIER, id: 'carrier', name: professionLabel('carrier') },
    // The scout's one allowed atomic is the signpost-erecting build-guide swing (jobtypes.ini 27
    // `allowatomic 43`) — the placeSignpost flow's animation gate.
    {
      typeId: JOB_SCOUT,
      id: 'scout',
      name: professionLabel('scout'),
      allowedAtomics: [BUILD_GUIDE_ATOMIC],
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
      allowedAtomics: [BUILD_HOUSE_ATOMIC],
    },
    { typeId: JOB_SOLDIER_SPEAR, id: 'soldier_spear', name: messages().admin.units.spear },
    { typeId: JOB_SOLDIER_SWORD, id: 'soldier_sword', name: messages().admin.units.sword },
    { typeId: JOB_SOLDIER_BROADSWORD, id: 'soldier_broadsword', name: messages().admin.units.broadsword },
    { typeId: JOB_ARCHER, id: 'soldier_bow', name: messages().admin.units.bow },
    { typeId: JOB_ARCHER_LONG, id: 'soldier_bow_long', name: messages().admin.units.longbow },
  ]) {
    jobs.set(job.typeId, job);
  }
  for (const profession of PROFESSIONS) {
    if (!jobs.has(profession.jobType)) {
      jobs.set(profession.jobType, { typeId: profession.jobType, id: profession.key });
    }
  }
  // The collector's harvest atomics — every gathered good's harvest atomic (fell/mine/pick). Shared by the
  // gatherer worker-slot trades below so a settler hand-assigned to a building's collector/hunter/fisher slot
  // can actually harvest and bank into the building (the building is its flag). Reusing the collector's set
  // for hunter/fisher is a named approximation: the sandbox has no distinct hunt/fish resources.
  const gathererAtomics = GATHERERS.map((gatherer) => gatherer.atomic);
  for (const slots of Object.values(BUILDING_WORKER_SLOTS)) {
    for (const worker of slots) {
      const jobType = rebaseSlotJob(worker.jobType);
      if (!jobs.has(jobType)) {
        const job: SandboxJob = {
          typeId: jobType,
          id: `worker_${jobType}`,
          name: workerSlotName(worker.jobType),
        };
        // A gatherer slot (original collector 8 / hunter 15 / fisher 22) is a real harvest trade: it
        // gathers a raw good on the map and delivers into its building, so it needs the harvest atomics.
        if (EXTRACTED_GATHERER_TRADES.has(worker.jobType))
          jobs.set(jobType, { ...job, allowedAtomics: gathererAtomics });
        else jobs.set(jobType, job);
      }
    }
  }
  for (const job of extras.jobs ?? []) {
    if (!jobs.has(job.typeId)) jobs.set(job.typeId, job);
  }
  return jobs;
}
