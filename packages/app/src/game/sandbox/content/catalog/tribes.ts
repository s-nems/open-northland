import type { JobEnables } from '@open-northland/data';
import {
  ATTACK_ATOMIC,
  CULTIVATE_ATOMIC,
  PLANT_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { HUMAN_HITPOINTS } from '../../../../catalog/units.js';
import { PRIMARY_TRIBE } from '../../../rules.js';
import {
  BUILD_HOUSE_ATOMIC,
  GATHERERS,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_FARMER_SLOT,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../../ids/index.js';
import {
  BUILD_HOUSE_ANIMATION,
  FARMER_REAP_ANIMATION,
  FARMER_SOW_ANIMATION,
  FARMER_WATER_ANIMATION,
  STORE_PICKUP_ANIMATION,
  STORE_PILEUP_ANIMATION,
} from '../../work-animations.js';
import type { SandboxContentExtras } from '../types.js';
import { SANDBOX_JOB_ENABLES } from './tech-graph.js';

export interface SandboxTribe {
  readonly typeId: number;
  readonly id: string;
  readonly hitpoints?: number;
  readonly jobEnables?: readonly JobEnables[];
  readonly atomicBindings?: unknown[];
}

/** Build the primary tribe's atomic bindings plus any caller-declared tribes. */
export function buildSandboxTribes(
  jobTypes: readonly number[],
  extras: SandboxContentExtras,
): Map<number, SandboxTribe> {
  const tribes = new Map<number, SandboxTribe>();
  tribes.set(PRIMARY_TRIBE, {
    typeId: PRIMARY_TRIBE,
    id: 'viking',
    hitpoints: HUMAN_HITPOINTS,
    atomicBindings: [
      ...GATHERERS.map((gatherer) => ({
        jobType: gatherer.job,
        atomicId: gatherer.atomic,
        animation: gatherer.animation,
      })),
      { jobType: JOB_SOLDIER_UNARMED, atomicId: ATTACK_ATOMIC, animation: 'viking_fist_attack' },
      { jobType: JOB_BUILDER, atomicId: BUILD_HOUSE_ATOMIC, animation: BUILD_HOUSE_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: WHEAT_HARVEST_ATOMIC, animation: FARMER_REAP_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: PLANT_ATOMIC, animation: FARMER_SOW_ANIMATION },
      { jobType: JOB_FARMER_SLOT, atomicId: CULTIVATE_ATOMIC, animation: FARMER_WATER_ANIMATION },
      { jobType: JOB_SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'viking_spear_attack' },
      { jobType: JOB_SOLDIER_SWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_sword_attack' },
      { jobType: JOB_SOLDIER_BROADSWORD, atomicId: ATTACK_ATOMIC, animation: 'viking_broadsword_attack' },
      { jobType: JOB_ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_attack' },
      { jobType: JOB_ARCHER_LONG, atomicId: ATTACK_ATOMIC, animation: 'viking_bow_long_attack' },
      ...jobTypes.flatMap((jobType) => [
        { jobType, atomicId: STORE_PICKUP_ATOMIC, animation: STORE_PICKUP_ANIMATION },
        { jobType, atomicId: STORE_PILEUP_ATOMIC, animation: STORE_PILEUP_ANIMATION },
      ]),
    ],
    // The real-shaped tech graph: the collector gates the economy houses + gathered goods, mirroring the
    // extracted viking `jobEnables` (see tech-graph.ts). This is what makes a gated workshop stay locked until
    // the tribe has its gatherer — exercised headlessly instead of only surfacing in browser play.
    jobEnables: SANDBOX_JOB_ENABLES,
  });
  for (const tribe of extras.tribes ?? []) {
    if (!tribes.has(tribe.typeId)) {
      // Extra tribes (enemy raiders, wildlife) carry no tech graph — an empty edge list gates nothing, so their
      // buildings stay enabled without needing an enabler settler.
      tribes.set(tribe.typeId, { typeId: tribe.typeId, id: tribe.id, hitpoints: HUMAN_HITPOINTS });
    }
  }
  return tribes;
}
