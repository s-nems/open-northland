import { CULTIVATE_ATOMIC, PLANT_ATOMIC, WHEAT_HARVEST_ATOMIC } from '../../../../catalog/atomics.js';
import { PROFESSIONS } from '../../../../catalog/professions.js';
import { type Messages, messages, professionLabel } from '../../../../i18n/index.js';
import {
  BUILD_HOUSE_ATOMIC,
  GATHERERS,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_FARMER_SLOT,
  JOB_IDLE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
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

const GATHERER_PROFESSIONS: Readonly<Record<string, keyof Messages['profession']>> = {
  wood: 'gatherer_wood',
  stone: 'gatherer_stone',
  mud: 'gatherer_mud',
  iron: 'gatherer_iron',
  gold: 'gatherer_gold',
  mushroom: 'gatherer_mushroom',
};

/** Build every functional, picker and worker-slot job the sandbox content references. */
export function buildSandboxJobs(extras: SandboxContentExtras): Map<number, SandboxJob> {
  const jobs = new Map<number, SandboxJob>();
  for (const job of [
    { typeId: JOB_IDLE, id: 'idle', name: professionLabel('idle') },
    ...GATHERERS.map((gatherer) => ({
      typeId: gatherer.job,
      id: `gatherer_${gatherer.id}`,
      name: professionLabel(GATHERER_PROFESSIONS[gatherer.id] ?? 'collector'),
      allowedAtomics: [gatherer.atomic],
    })),
    { typeId: JOB_CARRIER, id: 'carrier', name: professionLabel('carrier') },
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
  for (const slots of Object.values(BUILDING_WORKER_SLOTS)) {
    for (const worker of slots) {
      const jobType = rebaseSlotJob(worker.jobType);
      if (!jobs.has(jobType)) {
        jobs.set(jobType, {
          typeId: jobType,
          id: `worker_${jobType}`,
          name: workerSlotName(worker.jobType),
        });
      }
    }
  }
  for (const job of extras.jobs ?? []) {
    if (!jobs.has(job.typeId)) jobs.set(job.typeId, job);
  }
  return jobs;
}
