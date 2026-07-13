import {
  ATTACK_ATOMIC,
  CULTIVATE_ATOMIC,
  PLANT_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { PRIMARY_TRIBE } from '../../../rules.js';
import {
  BUILD_HOUSE_ATOMIC,
  GATHERERS,
  GOOD_COIN,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_FARMER_SLOT,
  JOB_IDLE,
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

export interface SandboxTribe {
  readonly typeId: number;
  readonly id: string;
  readonly jobEnables?: unknown[];
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
    jobEnables: [{ jobType: JOB_IDLE, kind: 'good', targetId: GOOD_COIN }],
  });
  for (const tribe of extras.tribes ?? []) {
    if (!tribes.has(tribe.typeId)) {
      tribes.set(tribe.typeId, {
        typeId: tribe.typeId,
        id: tribe.id,
        jobEnables: [{ jobType: JOB_IDLE, kind: 'good', targetId: GOOD_COIN }],
      });
    }
  }
  return tribes;
}
